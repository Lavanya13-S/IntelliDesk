'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

// Browser SpeechRecognition API types
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (() => void) | null;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }
}

export function VoiceInput({ onTranscript, disabled = false, className }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const SpeechRecog =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;
    setIsSupported(!!SpeechRecog);

    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecog) return;

    const recognition = new SpeechRecog();
    recognitionRef.current = recognition;

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setIsProcessing(false);
      setErrorMsg(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ')
        .trim();
      if (transcript) {
        onTranscript(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[VoiceInput] Recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setErrorMsg('Microphone access denied. Please allow microphone in browser settings.');
      } else if (event.error === 'network') {
        setErrorMsg('Network error. Speech recognition requires an internet connection.');
      } else if (event.error !== 'aborted') {
        setErrorMsg('Speech recognition failed. Please try again.');
      }
      setIsListening(false);
      setIsProcessing(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setIsProcessing(false);
    };

    try {
      recognition.start();
    } catch {
      setErrorMsg('Could not start microphone. Please try again.');
    }
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    setIsProcessing(true);
    recognitionRef.current?.stop();
  }, []);

  const handleToggle = () => {
    if (!isSupported) {
      setErrorMsg('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  if (!isSupported) {
    return null; // Hide completely if not supported
  }

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <Button
        type="button"
        size="icon"
        variant={isListening ? 'destructive' : 'outline'}
        onClick={handleToggle}
        disabled={disabled || isProcessing}
        className={cn(
          'h-9 w-9 transition-all duration-200',
          isListening && 'animate-pulse ring-2 ring-red-400 ring-offset-1'
        )}
        title={isListening ? 'Stop recording' : 'Start voice input'}
        aria-label={isListening ? 'Stop voice recording' : 'Start voice recording'}
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isListening ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>

      {isListening && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          Listening...
        </p>
      )}

      {errorMsg && (
        <p className="text-xs text-destructive max-w-[200px]">{errorMsg}</p>
      )}
    </div>
  );
}
