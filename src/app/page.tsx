'use client';
import MovementTracker from "./components/MovementTracker";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <MovementTracker />
    </main>
  );
}