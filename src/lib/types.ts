export interface QuestionRecord {
  id: string;
  testId: string;
  questionNumber: number;
  audioUrl: string;
  audioDuration: number | null;
  audioFilename: string;
  audioMimeType: string;
}

export interface TestRecord {
  id: string;
  testNumber: number;
  title: string;
  /** Number of recordings actually available, not an assumed exam length. */
  totalQuestions: number;
  questions: QuestionRecord[];
}

export interface ListeningProgressRecord {
  questionId: string;
  lastPlaybackPosition: number;
  isPlayed: boolean;
}

export interface CatalogResult {
  tests: TestRecord[];
  persistence: "cloud" | "local";
  error?: string;
}
