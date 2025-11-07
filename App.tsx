import React, { useState, useRef, useEffect } from 'react';
import { FEMALE_VOICES, MALE_VOICES } from './constants';
import { Voice } from './types';
import { generateSpeech } from './services/geminiService';

// Audio Decoding Utilities
// Fix: Corrected the return type from UintArray to Uint8Array.
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// WAV file creation utility
function createWavBlob(pcmData: Uint8Array): Blob {
    const sampleRate = 24000;
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
  
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
  
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
  
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
  
    return new Blob([view, pcmData], { type: 'audio/wav' });
}


// --- Components ---

interface VoiceCardProps {
  voice: Voice;
  isSelected: boolean;
  onSelect: (voice: Voice) => void;
  onPreview: (voiceId: string) => void;
  isPreviewing: boolean;
  isAnyLoading: boolean;
}

const VoiceCard: React.FC<VoiceCardProps> = ({ voice, isSelected, onSelect, onPreview, isPreviewing, isAnyLoading }) => {
  const genderColor = voice.gender === 'female' ? 'pink' : 'blue';

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the voice when clicking preview
    onPreview(voice.id);
  };

  return (
    <div
      onClick={() => onSelect(voice)}
      className={`cursor-pointer p-4 border-2 rounded-lg text-center transition-all duration-300 ease-in-out transform hover:-translate-y-1 relative ${
        isSelected
          ? `border-indigo-500 bg-indigo-500 bg-opacity-20 shadow-lg shadow-indigo-500/20`
          : 'border-gray-700 bg-gray-800 hover:border-indigo-400'
      }`}
    >
      <i className={`fas fa-${voice.gender} text-3xl mb-2 text-${genderColor}-400`}></i>
      <p className="font-semibold text-sm text-gray-300 pb-8">{voice.name}</p>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
        <button
            onClick={handlePreviewClick}
            disabled={isAnyLoading}
            aria-label={`Preview voice ${voice.name}`}
            className="w-8 h-8 rounded-full bg-gray-700/50 hover:bg-indigo-500/50 flex items-center justify-center text-gray-300 hover:text-white transition-colors duration-200 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {isPreviewing ? (
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                <i className="fas fa-play text-xs"></i>
            )}
        </button>
      </div>
    </div>
  );
};


const App: React.FC = () => {
  const [text, setText] = useState<string>('สวัสดี! ยินดีต้อนรับสู่โปรแกรมสร้างเสียงพูดด้วย AI');
  const [selectedVoice, setSelectedVoice] = useState<Voice>(FEMALE_VOICES[0]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'female' | 'male'>('female');
  const [generatedAudioBlob, setGeneratedAudioBlob] = useState<Blob | null>(null);
  const [pitch, setPitch] = useState<number>(1);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const PREVIEW_TEXT = "นี่คือตัวอย่างเสียง";

  useEffect(() => {
    if (!audioContextRef.current) {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
            audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        } else {
            setError("เบราว์เซอร์ของคุณไม่รองรับ Web Audio API");
        }
    }
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (currentSourceRef.current) {
      currentSourceRef.current.playbackRate.value = pitch;
    }
  }, [pitch]);

  const handleTabChange = (tab: 'female' | 'male') => {
    setActiveTab(tab);
    const defaultVoice = tab === 'female' ? FEMALE_VOICES[0] : MALE_VOICES[0];
    setSelectedVoice(defaultVoice);
    setGeneratedAudioBlob(null);
  };

  const handleVoiceSelect = (voice: Voice) => {
    setSelectedVoice(voice);
    setGeneratedAudioBlob(null);
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setGeneratedAudioBlob(null);
  }

  const handleGenerateAndPlay = async () => {
    if (!text.trim() || isLoading || previewingVoiceId) return;

    if(audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
    }
    
    setIsLoading(true);
    setError(null);
    setGeneratedAudioBlob(null);

    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }

    try {
      const base64Audio = await generateSpeech(text, selectedVoice.id);
      const audioBytes = decode(base64Audio);
      
      setGeneratedAudioBlob(createWavBlob(audioBytes));
      
      const audioCtx = audioContextRef.current;
      if (!audioCtx) {
        throw new Error("AudioContext is not available.");
      }

      const audioBuffer = await decodeAudioData(audioBytes, audioCtx, 24000, 1);
      
      const newSource = audioCtx.createBufferSource();
      newSource.buffer = audioBuffer;
      newSource.playbackRate.value = pitch;
      newSource.connect(audioCtx.destination);
      newSource.start();

      newSource.onended = () => {
        if (currentSourceRef.current === newSource) {
          currentSourceRef.current = null;
        }
      };
      currentSourceRef.current = newSource;

    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("เกิดข้อผิดพลาดที่ไม่รู้จัก");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = async (voiceId: string) => {
    if (isLoading || previewingVoiceId) return;

    if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
    }

    if (currentSourceRef.current) {
        currentSourceRef.current.stop();
        currentSourceRef.current = null;
    }

    setPreviewingVoiceId(voiceId);
    setError(null);

    try {
        const base64Audio = await generateSpeech(PREVIEW_TEXT, voiceId);
        const audioBytes = decode(base64Audio);
        const audioCtx = audioContextRef.current;
        if (!audioCtx) {
            throw new Error("AudioContext is not available.");
        }

        const audioBuffer = await decodeAudioData(audioBytes, audioCtx, 24000, 1);
        const previewSource = audioCtx.createBufferSource();
        previewSource.buffer = audioBuffer;
        previewSource.connect(audioCtx.destination);
        previewSource.start();

        previewSource.onended = () => {
            setPreviewingVoiceId(null);
        };
    } catch (err) {
        if (err instanceof Error) {
            setError(err.message);
        } else {
            setError("เกิดข้อผิดพลาดในการเล่นตัวอย่างเสียง");
        }
        setPreviewingVoiceId(null);
    }
  };


  const handleDownload = () => {
    if (!generatedAudioBlob) return;
    const url = URL.createObjectURL(generatedAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generated_speech.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const currentVoices = activeTab === 'female' ? FEMALE_VOICES : MALE_VOICES;

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl mx-auto bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-2xl shadow-indigo-500/10 p-6 md:p-8 border border-gray-700">
        <header className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 text-transparent bg-clip-text">
            โปรแกรมสร้างเสียงจากข้อความ
          </h1>
          <p className="text-gray-400 mt-2">เปลี่ยนข้อความของคุณให้เป็นเสียงพูดที่เป็นธรรมชาติ</p>
        </header>

        <main>
          <div className="mb-6">
            <label htmlFor="text-input" className="block text-lg font-medium text-gray-300 mb-2">
              ใส่ข้อความของคุณ
            </label>
            <textarea
              id="text-input"
              value={text}
              onChange={handleTextChange}
              placeholder="พิมพ์ข้อความที่นี่..."
              rows={5}
              className="w-full p-4 bg-gray-900 border-2 border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors duration-200 text-gray-200 resize-none"
            />
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-300 mb-4">เลือกเสียงที่ต้องการ</h3>
            <div className="flex border-b border-gray-700 mb-4">
                <button onClick={() => handleTabChange('female')} className={`px-6 py-2 text-lg font-medium transition-colors duration-200 ${activeTab === 'female' ? 'border-b-2 border-pink-400 text-pink-400' : 'text-gray-400 hover:text-white'}`}>
                    <i className="fas fa-venus mr-2"></i>หญิง
                </button>
                <button onClick={() => handleTabChange('male')} className={`px-6 py-2 text-lg font-medium transition-colors duration-200 ${activeTab === 'male' ? 'border-b-2 border-blue-400 text-blue-400' : 'text-gray-400 hover:text-white'}`}>
                    <i className="fas fa-mars mr-2"></i>ชาย
                </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {currentVoices.map((voice) => (
                <VoiceCard
                  key={voice.id}
                  voice={voice}
                  isSelected={selectedVoice.id === voice.id}
                  onSelect={handleVoiceSelect}
                  onPreview={handlePreview}
                  isPreviewing={previewingVoiceId === voice.id}
                  isAnyLoading={isLoading || previewingVoiceId !== null}
                />
              ))}
            </div>
             <p className="text-center text-gray-400 mt-4 text-sm">
                เสียงที่เลือก: <span className="font-semibold text-indigo-300">{selectedVoice.name}</span>
            </p>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-medium text-gray-300 mb-2">ปรับระดับเสียงสูงต่ำ (Pitch)</h3>
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm">ต่ำ</span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={pitch}
                onChange={(e) => setPitch(Number(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                aria-label="Pitch control"
              />
              <span className="text-gray-400 text-sm">สูง</span>
            </div>
            <p className="text-center text-gray-400 mt-2 text-sm">
              ค่าปัจจุบัน: {pitch.toFixed(2)}
            </p>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6 text-center">
              <p>{error}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleGenerateAndPlay}
              disabled={isLoading || !text.trim() || !!previewingVoiceId}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-4 px-4 rounded-lg flex items-center justify-center transition-all duration-300 text-lg shadow-lg hover:shadow-indigo-500/40 transform hover:-translate-y-0.5"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังสร้างเสียง...
                </>
              ) : (
                <>
                  <i className="fas fa-play mr-3"></i>
                  สร้างและเล่นเสียง
                </>
              )}
            </button>
             <button
              onClick={handleDownload}
              disabled={isLoading || !generatedAudioBlob}
              className="w-full sm:w-auto bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700/50 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center transition-all duration-300"
              aria-label="Download generated audio"
            >
              <i className="fas fa-download mr-3"></i>
              ดาวน์โหลด
            </button>
          </div>
        </main>
        
        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>ขับเคลื่อนโดย Google Gemini API</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
