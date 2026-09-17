'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceOutputProps {
  text: string;
  disabled?: boolean;
  className?: string;
  voiceRate?: number;
}

export function VoiceOutput({ text, disabled = false, className, voiceRate = 1.0 }: VoiceOutputProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setIsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    // Cancel speech on unmount
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const speak = useCallback(() => {
    if (!text || !isSupported) return;

    window.speechSynthesis.cancel();
    setIsLoading(true);

    const utterance = new SpeechSynthesisUtterance(text);
    utteranceRef.current = utterance;

    // Prefer a natural English voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.lang.startsWith('en') && v.localService
    ) || voices.find((v) => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;

    utterance.rate = voiceRate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsLoading(false);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsLoading(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsLoading(false);
    };

    window.speechSynthesis.speak(utterance);
  }, [text, isSupported, voiceRate]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setIsLoading(false);
  }, []);

  const handleToggle = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      speak();
    }
  };

  if (!isSupported || !text) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant={isSpeaking ? 'secondary' : 'ghost'}
      onClick={handleToggle}
      disabled={disabled}
      className={cn(
        'h-8 w-8 transition-all',
        isSpeaking && 'text-primary',
        className
      )}
      title={isSpeaking ? 'Stop reading' : 'Read response aloud'}
      aria-label={isSpeaking ? 'Stop voice output' : 'Read response aloud'}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isSpeaking ? (
        <Square className="h-3.5 w-3.5" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </Button>
  );
}
