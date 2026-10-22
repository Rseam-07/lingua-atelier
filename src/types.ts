export interface Settings {
  folder: string; asrUrl: string; whisperBinary: string; whisperModel: string;
  asrEngine: 'whisper' | 'qwen' | 'ondevice' | 'cloud'; qwenUrl: string; qwenPython: string; qwenServer: string; qwenModel: string;
  autoLaunch: boolean; language: string; chunkSeconds: number; silenceRms: number;
  dualRecognition: boolean;
  llmMode: 'ollama' | 'compatible' | 'ondevice'; llmUrl: string; llmModel: string; llmBinary: string;
  secretName: string; deviceId: string; audioSource: 'microphone' | 'system';
  asrSecretName:string;
  summaryEvery: number; summarySeconds: number; openOnStartup: boolean;
  glossary: string;
  asrUseGlossary:boolean;
  systemAudioHelper: string;
  vadModel: string; preserveWeakSpeech: boolean;
  setupCompleted:boolean; localSpeechModel:string; localTextModel:string;
  cloudRegion:'cn'|'intl'; cloudSecretName:string; cloudConsent:boolean; llmUseCloudKey:boolean;
}
export const DEFAULTS: Settings = {
  folder: 'Lingua', asrUrl: 'http://127.0.0.1:8180',
  asrEngine: 'qwen', qwenUrl: 'http://127.0.0.1:8182',
  qwenPython:'',qwenServer:'',qwenModel:'',whisperBinary:'',whisperModel:'',
  autoLaunch: true, language: 'auto', chunkSeconds: 8, silenceRms: 0.003,
  dualRecognition: true,
  llmMode: 'ollama', llmUrl: 'http://127.0.0.1:11434', llmModel: 'qwen2.5:3b',
  llmBinary: '', secretName: 'lingua-atelier-api', deviceId: 'default', audioSource: 'microphone',
  asrSecretName:'lingua-atelier-asr',
  summaryEvery: 3, summarySeconds: 30, openOnStartup: false,
  glossary: '',asrUseGlossary:false,
  systemAudioHelper: '',
  vadModel: '',
  preserveWeakSpeech: true,
  setupCompleted:false,localSpeechModel:'whisper-base',localTextModel:'qwen-text-0.5b',
  cloudRegion:'cn',cloudSecretName:'lingua-atelier-cloud',cloudConsent:false,llmUseCloudKey:false,
};
export type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing' | 'complete' | 'demo';
export interface Segment {
  id: number; start: number; end: number; source: string; translation: string;
  status: 'pending' | 'done' | 'error'; error?: string;
  reviewRequired?: boolean;
}
export type RecognitionLanguage = 'fr' | 'zh';
export interface RecognitionCandidate {
  language: RecognitionLanguage; text: string; avgLogprob?: number;
  truncated?: boolean; error?: string;
}
export interface LanguageEvidence {
  method:'unforced-prefix-token'; logprobs:{fr:number;zh:number}; margin:number; calibrated:false;
}
export interface RecognitionComparison {
  candidates: RecognitionCandidate[]; selected: RecognitionLanguage | null;
  reason: string; reviewRequired: boolean; method: 'agreement' | 'acoustic' | 'context' | 'fallback' | 'guard' | 'uncertain' | 'manual';
  languageEvidence?:LanguageEvidence;
  decodingMs: number; judgingMs: number;
}
export interface RecognitionResult { text: string; comparison: RecognitionComparison; }
export interface AudioPart { path: string; start: number; end: number; status: 'saved' | 'done' | 'error' | 'silent' | 'review'; error?: string; recognition?: RecognitionComparison; }
export interface Bookmark { time: number; text: string; }
export interface ProcessingMetric {
  stage:'asr'|'translation'|'summary'; durationMs:number; waitMs:number; audioEnd:number;
  cancelled?:boolean;
}
export interface Session {
  id: string; title: string; created: string; phase: Phase; duration: number;
  kind?: 'classroom' | 'test';
  reviewRequired?: boolean;
  segments: Segment[]; audio: AudioPart[]; outline: string; bookmarks: Bookmark[];
  notePath: string; journalPath: string; draft: string; errors: string[];
  summaryVersion: number; demo: boolean; metrics?:ProcessingMetric[];
}
export interface Health { asr: boolean; llm: boolean; model: boolean; message: string; }
export interface Chunk { samples: Float32Array; start: number; end: number; }
export const RATE = 16000;
