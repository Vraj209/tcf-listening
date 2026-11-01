"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Headphones, LoaderCircle, Moon, Pause, Play, RotateCcw, RotateCw, Search, SkipBack, SkipForward, Sun, Volume2, VolumeX } from "lucide-react";
import type { TestRecord } from "@/lib/types";
import { useListeningPlayer } from "@/hooks/use-listening-player";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const pad = (value: number) => String(value).padStart(2, "0");
function timeLabel(value: number) { const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; return `${Math.floor(safe / 60)}:${pad(safe % 60)}`; }
const rangeStyle = (value: number, max: number) => ({ "--range-progress": `${Math.min(100, Math.max(0, max > 0 ? value / max * 100 : 0))}%` }) as CSSProperties;

export function ListeningApp({ tests, persistence, catalogError }: { tests: TestRecord[]; persistence: "cloud" | "local"; catalogError?: string }) {
  const { audioRef, test, question: currentQuestion, currentIndex, playing, loading, error, currentTime, duration, speed, volume, autoPlay, played, ready, syncError, selectTest, selectQuestion, togglePlay, previous, next, seek, skip, setSpeed, setVolume, setAutoPlay, retry, audioEvents } = useListeningPlayer(tests);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(false);
  const activeQuestion = useRef<HTMLButtonElement>(null);
  const questionNav = useRef<HTMLDivElement>(null);
  const currentTest = test ?? tests[0];
  const questions = currentTest?.questions ?? [];
  const currentTestIndex = tests.findIndex((test) => test.id === currentTest?.id);
  const playedCount = questions.filter((question) => played[question.id]).length;
  const available = Boolean(currentQuestion);
  const searchValue = search.trim().replace(/^test\s*/i, "").replace(/^0+(?=\d)/, "");
  const filteredTests = tests.filter((test) => !searchValue || String(test.testNumber).includes(searchValue));

  useEffect(() => {
    let theme: string | null = null;
    try { theme = localStorage.getItem("tcf-listening-theme"); } catch { /* Storage may be unavailable in private browsing. */ }
    const nextDark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", nextDark);
    // Match the saved appearance after hydration.
    const frame = requestAnimationFrame(() => setDark(nextDark));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const active = activeQuestion.current;
    const nav = questionNav.current;
    if (!active || !nav) return;
    if (nav.scrollWidth > nav.clientWidth) {
      const left = active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
      nav.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
  }, [currentQuestion?.id]);

  const toggleTheme = () => {
    const value = !dark;
    setDark(value);
    document.documentElement.classList.toggle("dark", value);
    try { localStorage.setItem("tcf-listening-theme", value ? "dark" : "light"); } catch { /* Preference remains usable for this session. */ }
  };
  const chooseTest = (testNumber: number) => { selectTest(testNumber); setSelectorOpen(false); setSearch(""); };

  return (
    <div className="listening-app">
      <audio ref={audioRef} preload="metadata" {...audioEvents} />
      <header className="site-header">
        <div className="wordmark" aria-label="TCF Listening"><span className="brand-icon"><Headphones size={19} strokeWidth={1.8} /></span><span>TCF <span className="wordmark-light">Listening</span></span></div>
        <div className="header-actions">
          <Dialog open={selectorOpen} onOpenChange={(open) => { setSelectorOpen(open); if (!open) setSearch(""); }}>
            <DialogTrigger asChild>
              <Button className="test-selector" variant="outline" aria-label={`Select test. Current test ${currentTest?.testNumber ?? 1}`}><span>Test {pad(currentTest?.testNumber ?? 1)}</span><ChevronDown size={15} /></Button>
            </DialogTrigger>
            <DialogContent>
              <div className="dialog-heading"><DialogTitle className="dialog-title">Choose a test</DialogTitle><DialogDescription className="dialog-description">Your listening collection</DialogDescription></div>
              <label className="test-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a test…" aria-label="Search tests" autoComplete="off" inputMode="numeric" /></label>
              <div className="test-grid">
                {filteredTests.map((test) => <button key={test.id} className={`test-option ${test.id === currentTest?.id ? "is-selected" : ""}`} onClick={() => chooseTest(test.testNumber)} aria-label={`Test ${pad(test.testNumber)}, ${test.questions.length} audio questions`} aria-current={test.id === currentTest?.id ? "true" : undefined}><span className="test-option-number">{pad(test.testNumber)}{test.id === currentTest?.id && <Check size={13} />}</span><span className="test-option-count">{test.questions.length ? `${test.questions.length} audio` : "No audio"}</span></button>)}
                {!filteredTests.length && <p className="search-empty">No tests found.</p>}
              </div>
            </DialogContent>
          </Dialog>
          <Button className="theme-toggle" variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? "Use light appearance" : "Use dark appearance"} title={dark ? "Light appearance" : "Dark appearance"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</Button>
        </div>
      </header>

      <main className="main-content">
        <section className="test-navigation" aria-label="Test and question navigation">
          <div className="section-heading">
            <div className="section-heading-title"><span className="eyebrow">YOUR PRACTICE</span><h1>Test {pad(currentTest?.testNumber ?? 1)}</h1></div>
            <div className="test-progress" aria-label={`${playedCount} of ${questions.length} questions played`}><span>{playedCount}<span className="progress-total"> / {questions.length}</span> <span className="progress-label">played</span></span><span className="progress-track"><span style={{ width: `${questions.length ? playedCount / questions.length * 100 : 0}%` }} /></span></div>
          </div>
          {!!questions.length && <div className="question-nav" ref={questionNav} aria-label="Questions">{questions.map((question) => {
            const selected = question.id === currentQuestion?.id;
            return <button key={question.id} ref={selected ? activeQuestion : undefined} type="button" className={`question-chip ${selected ? "is-active" : ""} ${played[question.id] ? "is-played" : ""}`} onClick={() => selectQuestion(question.id)} aria-label={`Question ${question.questionNumber}${played[question.id] ? ", played" : ""}`} aria-current={selected ? "true" : undefined}><span className="question-prefix">Q</span>{pad(question.questionNumber)}{played[question.id] && <span className="played-dot" />}</button>;
          })}</div>}
        </section>

        <section className={`player-panel ${!available ? "player-panel-empty" : ""}`} aria-label="Audio player" aria-busy={loading}>
          {available ? <>
            <div className="player-heading"><div className="track-caption"><span className={`status-dot ${playing ? "is-playing" : ""}`} /><span>TEST {pad(currentTest?.testNumber ?? 1)}</span><span className="caption-divider">/</span><span>COMPRÉHENSION ORALE</span></div><h2>Question {pad(currentQuestion!.questionNumber)}</h2><span className="question-position">{currentIndex + 1} of {questions.length}</span></div>
            <div className="timeline"><label className="sr-only" htmlFor="audio-seek">Playback position</label><input id="audio-seek" className="range-input seek-input" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(currentTime, duration || 0)} onChange={(event) => seek(Number(event.target.value))} disabled={!duration} style={rangeStyle(currentTime, duration)} aria-valuetext={`${timeLabel(currentTime)} of ${timeLabel(duration)}`} /><div className="time-labels"><span>{timeLabel(currentTime)}</span><span>{timeLabel(duration)}</span></div></div>
            <div className="transport-controls">
              <Button variant="ghost" size="icon" className="transport-secondary" onClick={previous} disabled={currentIndex <= 0} aria-label="Previous question" title="Previous question (P)"><SkipBack size={22} fill="currentColor" strokeWidth={1.5} /></Button>
              <Button variant="ghost" size="icon" className="skip-seconds" onClick={() => skip(-10)} disabled={!duration} aria-label="Rewind 10 seconds" title="Rewind 10 seconds (←)"><RotateCcw size={29} strokeWidth={1.5} /><span>10</span></Button>
              <button className="play-button" onClick={togglePlay} disabled={!ready} aria-label={playing ? "Pause audio" : "Play audio"} title={playing ? "Pause (Space)" : "Play (Space)"}>{loading && !playing ? <LoaderCircle size={29} className="loading-spinner" /> : playing ? <Pause size={30} fill="currentColor" strokeWidth={1.5} /> : <Play size={31} fill="currentColor" strokeWidth={1.5} className="play-symbol" />}</button>
              <Button variant="ghost" size="icon" className="skip-seconds" onClick={() => skip(10)} disabled={!duration} aria-label="Forward 10 seconds" title="Forward 10 seconds (→)"><RotateCw size={29} strokeWidth={1.5} /><span>10</span></Button>
              <Button variant="ghost" size="icon" className="transport-secondary" onClick={next} disabled={currentIndex >= questions.length - 1} aria-label="Next question" title="Next question (N)"><SkipForward size={22} fill="currentColor" strokeWidth={1.5} /></Button>
            </div>
            <div className="player-message" aria-live="polite">{error ? <span className="playback-error">{error}<button onClick={retry}>Try again</button></span> : loading ? <span>Loading audio…</span> : <span className="play-state-label">{playing ? "Listening" : currentTime > 0 ? "Ready when you are" : "Press play to begin"}</span>}</div>
            <div className="player-preferences"><div className="speed-control"><label htmlFor="playback-speed">Speed</label><select id="playback-speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select><ChevronDown size={12} aria-hidden="true" /></div><div className="volume-control"><button className="volume-button" onClick={() => setVolume(volume > 0 ? 0 : 1)} aria-label={volume > 0 ? "Mute audio" : "Unmute audio"}>{volume > 0 ? <Volume2 size={17} /> : <VolumeX size={17} />}</button><label className="sr-only" htmlFor="audio-volume">Volume</label><input id="audio-volume" className="range-input volume-input" type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} style={rangeStyle(volume, 1)} /></div><label className="autoplay-control" htmlFor="autoplay-next">Auto-play next<Switch id="autoplay-next" checked={autoPlay} onCheckedChange={setAutoPlay} /></label></div>
          </> : <div className="empty-player"><span className="empty-icon"><Headphones size={28} strokeWidth={1.4} /></span><span className="eyebrow">TEST {pad(currentTest?.testNumber ?? 1)}</span><h2>Audio not available</h2><p>{catalogError || "Choose another test to keep listening."}</p><Button variant="outline" onClick={() => setSelectorOpen(true)}>Choose a test<ChevronDown size={15} /></Button></div>}
        </section>

        <nav className="adjacent-tests" aria-label="Switch tests"><Button variant="ghost" onClick={() => chooseTest(tests[currentTestIndex - 1].testNumber)} disabled={currentTestIndex <= 0} className="previous-test"><ArrowLeft size={16} /><span>Previous test</span></Button><span className="test-counter">{pad(currentTest?.testNumber ?? 1)} <span>/</span> {pad(tests.length)}</span><Button variant="ghost" onClick={() => chooseTest(tests[currentTestIndex + 1].testNumber)} disabled={currentTestIndex >= tests.length - 1} className="next-test"><span>Next test</span><ArrowRight size={16} /></Button></nav>
        {(syncError || catalogError) && available && <p className="sync-notice" role="status">{syncError || catalogError}</p>}
      </main>
      <footer className="site-footer"><span className="footer-status"><span />{persistence === "cloud" && !syncError ? "Progress saved" : "Progress saved on this device"}</span><div className="keyboard-hints" aria-label="Keyboard shortcuts"><span><kbd>space</kbd> play / pause</span><span><kbd>←</kbd><kbd>→</kbd> 10 sec</span><span><kbd>N</kbd> next</span></div></footer>
    </div>
  );
}
export default ListeningApp;
