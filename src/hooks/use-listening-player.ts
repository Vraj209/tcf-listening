"use client";
/* Browser storage hydration and native audio events synchronize external state after SSR. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TestRecord } from "@/lib/types";
import { clampPosition, isShortcutTarget, normalizePreferences, SPEEDS, STORAGE_KEY } from "@/lib/player-state";

type Progress = Record<string, { position: number; played: boolean }>;

export function useListeningPlayer(tests: TestRecord[]) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [testNumber, setTestNumber] = useState(tests[0]?.testNumber ?? 1);
  const [questionId, setQuestionId] = useState(tests[0]?.questions[0]?.id ?? "");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, updateSpeed] = useState(1);
  const [volume, updateVolume] = useState(1);
  const [autoPlay, updateAutoPlay] = useState(false);
  const [played, setPlayed] = useState<Record<string, boolean>>({});
  const test = tests.find(t => t.testNumber === testNumber) ?? tests[0];
  const question = test?.questions.find(q => q.id === questionId) ?? test?.questions[0];
  const currentIndex = test?.questions.findIndex(q => q.id === question?.id) ?? -1;
  const progress = useRef<Progress>({});
  const selected = useRef(question);
  const desirePlay = useRef(false);
  const generation = useRef(0);
  const cloud = useRef(false);
  const lastSync = useRef(0);
  const lastLocalSave = useRef(0);
  const metadataReady = useRef(false);
  const pendingResume = useRef(0);
  const saveSnapshot = useRef<() => void>(() => {});

  const saveLocal = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, testNumber, questionId: question?.id, speed, volume, autoPlay, progress: progress.current }));
    } catch { /* Listening remains available when browser storage is full or disabled. */ }
  }, [testNumber, question, speed, volume, autoPlay]);

  const sync = useCallback((id: string, keepalive = false) => {
    if (!cloud.current || !progress.current[id]) return;
    const entry = progress.current[id];
    void fetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: id, lastPlaybackPosition: entry.position, isPlayed: entry.played }), keepalive })
      .then(r => { if (!r.ok) throw new Error("sync"); setSyncError(null); })
      .catch(() => setSyncError("Progress is saved on this device. Cloud sync is temporarily unavailable."));
  }, []);

  const snapshot = useCallback((send = false, forceLocal = false) => {
    const a = audioRef.current;
    const q = selected.current;
    if (!q || !a || !metadataReady.current) return;
    const prior = progress.current[q.id];
    const isPlayed = Boolean(prior?.played || a.currentTime >= 1 || a.ended);
    progress.current[q.id] = { position: a.ended ? 0 : Math.max(0, a.currentTime || 0), played: isPlayed };
    if (isPlayed && !prior?.played) setPlayed(p => ({ ...p, [q.id]: true }));
    if (send || forceLocal || Date.now() - lastLocalSave.current >= 2000) {
      saveSnapshot.current(); lastLocalSave.current = Date.now();
    }
    if (send) sync(q.id);
  }, [sync]);

  useEffect(() => { saveSnapshot.current = saveLocal; if (ready) saveLocal(); }, [saveLocal, ready]);

  useEffect(() => {
    let active = true;
    try {
      const stored = normalizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"), tests);
      setTestNumber(stored.testNumber); setQuestionId(stored.questionId);
      updateSpeed(stored.speed); updateVolume(stored.volume); updateAutoPlay(stored.autoPlay);
      progress.current = stored.progress;
      setPlayed(Object.fromEntries(Object.entries(stored.progress).map(([id, value]) => [id, value.played])));
    } catch { /* Invalid preferences reset safely. */ }
    setReady(true);
    void fetch("/api/progress").then(async r => {
      if (!r.ok) throw new Error("sync");
      return r.json();
    }).then(data => {
      if (!active) return;
      cloud.current = data.persistence === "cloud";
      if (Array.isArray(data.progress)) {
        for (const p of data.progress) {
          if (typeof p.questionId !== "string" || !Number.isFinite(p.lastPlaybackPosition)) continue;
          const existing = progress.current[p.questionId];
          progress.current[p.questionId] = { position: existing?.position ?? Math.max(0, p.lastPlaybackPosition), played: Boolean(existing?.played || p.isPlayed) };
        }
        setPlayed(Object.fromEntries(Object.entries(progress.current).map(([id, p]) => [id, p.played])));
        const a = audioRef.current;
        const resume = selected.current && progress.current[selected.current.id]?.position;
        if (!metadataReady.current && resume) pendingResume.current = resume;
        if (a && a.readyState >= 1 && a.paused && a.currentTime === 0 && resume) a.currentTime = clampPosition(resume, a.duration);
        saveSnapshot.current();
      }
    }).catch(() => { if (active) setSyncError("Progress is saved on this device. Cloud sync is temporarily unavailable."); });
    return () => { active = false; };
  }, [tests]);

  const play = useCallback(async () => {
    const a = audioRef.current;
    if (!a || !selected.current) return;
    const version = generation.current;
    setError(null);
    try { await a.play(); }
    catch (e) {
      if (version !== generation.current || (e instanceof DOMException && e.name === "AbortError")) return;
      desirePlay.current = false; setPlaying(false); setLoading(false);
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Tap play to start listening." : "This audio could not be played. Try again.");
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const a = audioRef.current;
    if (!a) return;
    generation.current += 1;
    metadataReady.current = false;
    pendingResume.current = question ? progress.current[question.id]?.position ?? 0 : 0;
    a.pause();
    selected.current = question;
    setPlaying(false); setCurrentTime(0); setError(null);
    setDuration(question?.audioDuration ?? 0);
    setLoading(Boolean(question));
    if (question) { a.src = question.audioUrl; a.load(); }
    else { a.removeAttribute("src"); a.load(); setLoading(false); }
    if (question && desirePlay.current) void play();
    desirePlay.current = false;
  }, [question, ready, play]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed, question]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  const changeQuestion = useCallback((id: string, continuePlaying: boolean) => {
    if (id === selected.current?.id) return;
    snapshot(true);
    audioRef.current?.pause();
    desirePlay.current = continuePlaying;
    setQuestionId(id);
  }, [snapshot]);

  const selectTest = useCallback((number: number) => {
    const nextTest = tests.find(t => t.testNumber === number);
    if (!nextTest || number === testNumber) return;
    snapshot(true); audioRef.current?.pause(); desirePlay.current = false;
    setTestNumber(number); setQuestionId(nextTest.questions[0]?.id ?? "");
  }, [tests, testNumber, snapshot]);

  const selectQuestion = useCallback((id: string) => {
    if (test?.questions.some(q => q.id === id)) changeQuestion(id, Boolean(audioRef.current && !audioRef.current.paused));
  }, [test, changeQuestion]);

  const previous = useCallback(() => { const q = test?.questions[currentIndex - 1]; if (q) selectQuestion(q.id); }, [test, currentIndex, selectQuestion]);
  const next = useCallback(() => { const q = test?.questions[currentIndex + 1]; if (q) selectQuestion(q.id); }, [test, currentIndex, selectQuestion]);
  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !selected.current) return;
    if (a.paused) { if (a.error) a.load(); void play(); }
    else { a.pause(); snapshot(true); }
  }, [play, snapshot]);
  const seek = useCallback((value: number) => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    a.currentTime = clampPosition(value, a.duration); setCurrentTime(a.currentTime); snapshot(false, true);
  }, [snapshot]);
  const skip = useCallback((seconds: number) => seek((audioRef.current?.currentTime ?? 0) + seconds), [seek]);
  const setSpeed = useCallback((value: number) => { if ((SPEEDS as readonly number[]).includes(value)) updateSpeed(value); }, []);
  const setVolume = useCallback((value: number) => { if (Number.isFinite(value)) updateVolume(Math.max(0, Math.min(1, value))); }, []);
  const retry = useCallback(() => { const a = audioRef.current; if (!a || !selected.current) return; setError(null); setLoading(true); a.load(); void play(); }, [play]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isShortcutTarget(e.target) || document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.key === " " && e.target instanceof Element && e.target.closest('button,a,[role="button"],[role="switch"]')) return;
      const keys: Record<string, () => void> = { " ": togglePlay, ArrowLeft: () => skip(-10), ArrowRight: () => skip(10), n: next, p: previous, N: next, P: previous, "+": () => setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed as typeof SPEEDS[number]) + 1)]), "=": () => setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed as typeof SPEEDS[number]) + 1)]), "-": () => setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed as typeof SPEEDS[number]) - 1)]) };
      if (keys[e.key]) { e.preventDefault(); if (!e.repeat || e.key.startsWith("Arrow")) keys[e.key](); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [togglePlay, skip, next, previous, speed, setSpeed]);

  useEffect(() => {
    const save = () => { snapshot(false, true); if (selected.current) sync(selected.current.id, true); };
    const visibility = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", visibility); };
  }, [snapshot, sync]);

  const audioEvents = {
    onLoadedMetadata: () => {
      const a = audioRef.current; if (!a) return;
      setDuration(Number.isFinite(a.duration) ? a.duration : question?.audioDuration ?? 0); setLoading(false);
      const resume = pendingResume.current;
      if (resume && Number.isFinite(a.duration)) { a.currentTime = resume >= a.duration - 0.5 ? 0 : clampPosition(resume, a.duration); setCurrentTime(a.currentTime); }
      metadataReady.current = true;
      a.playbackRate = speed;
    },
    onCanPlay: () => setLoading(false),
    onPlaying: () => { setPlaying(true); setLoading(false); setError(null); },
    onPause: () => { setPlaying(false); snapshot(true); },
    onWaiting: () => setLoading(true),
    onTimeUpdate: () => {
      const a = audioRef.current; if (!a) return;
      setCurrentTime(a.currentTime);
      const now = Date.now(); if (now - lastSync.current > 15000) { snapshot(true); lastSync.current = now; } else snapshot();
    },
    onEnded: () => {
      snapshot(true); setPlaying(false); setLoading(false);
      const q = test?.questions[currentIndex + 1];
      if (autoPlay && q) changeQuestion(q.id, true);
    },
    onError: () => { if (!selected.current) return; setLoading(false); setPlaying(false); setError("Audio is unavailable. Check your connection and try again."); },
  };

  return { audioRef, test, question, currentIndex, playing, loading, error, currentTime, duration, speed, volume, autoPlay, played, ready, syncError, selectTest, selectQuestion, togglePlay, previous, next, seek, skip, setSpeed, setVolume, setAutoPlay: updateAutoPlay, retry, audioEvents };
}
