"use client";
export default function ErrorPage({ reset }: {reset: () => void}) { return <main className="fallback-screen"><h1>One moment.</h1><p>The listening library could not load.</p><button onClick={reset}>Try again</button></main>; }
