import { settings } from './store';

/** 用系统语音报牌（跟随「音效」开关；浏览器不支持时静默） */
export function speak(text: string, opts: { interrupt?: boolean } = {}) {
  if (!text || !settings.get().sound) return;
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang === 'zh-CN') ?? voices.find((v) => v.lang.startsWith('zh'));
    if (opts.interrupt !== false) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.15;
    if (voice) u.voice = voice;
    synth.speak(u);
  } catch {
    // 语音不可用时静默
  }
}
