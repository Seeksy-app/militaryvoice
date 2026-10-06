/**
 * The after-show survey: one question a screen, tap to answer, a minute in
 * all. The keys are what's stored; the labels are only what people read.
 */
export type SurveyQuestion = {
  key: string;
  prompt: string;
  /** one: tap and move on. many: pick some, then Next. text: optional words. */
  kind: "one" | "many" | "text";
  hint?: string;
  max?: number;
  choices: { key: string; label: string; emoji?: string }[];
};

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    key: "experience", kind: "one", prompt: "How was your day with us?",
    choices: [
      { key: "5", label: "Loved it", emoji: "🤩" },
      { key: "4", label: "Really good", emoji: "😀" },
      { key: "3", label: "Okay", emoji: "🙂" },
      { key: "2", label: "Not great", emoji: "😕" },
      { key: "1", label: "Bad", emoji: "😞" },
    ],
  },
  {
    key: "again", kind: "one", prompt: "Would you do another event like this?",
    choices: [
      { key: "yes", label: "Yes, count me in" },
      { key: "maybe", label: "Maybe" },
      { key: "no", label: "No" },
    ],
  },
  {
    key: "mattered", kind: "many", max: 2, prompt: "What mattered most to you?", hint: "Pick up to two.",
    choices: [
      { key: "heard", label: "My story being heard" },
      { key: "listeners", label: "Reaching new listeners" },
      { key: "clips", label: "The clips we made" },
      { key: "community", label: "Meeting other military podcasters" },
      { key: "studio", label: "The studio itself" },
    ],
  },
  {
    key: "si", kind: "one", prompt: "Do you use SI (AI) for your podcast today?",
    choices: [
      { key: "lot", label: "Yes, a lot" },
      { key: "little", label: "A little" },
      { key: "learn", label: "Not yet, but I want to learn" },
      { key: "no", label: "Not for me" },
    ],
  },
  {
    key: "next", kind: "many", prompt: "What would help you most next?", hint: "Pick as many as you like.",
    choices: [
      { key: "cheaper-clips", label: "Cheaper clips" },
      { key: "own-studio", label: "My own studio for my show" },
      { key: "audience", label: "Growing my audience" },
      { key: "sponsors", label: "Finding sponsors" },
      { key: "learn-si", label: "Learning SI tools" },
      { key: "hosting", label: "Hosting my podcast" },
    ],
  },
  {
    key: "clip-price", kind: "one", prompt: "For clips from each episode, what feels fair?",
    choices: [
      { key: "free", label: "Free, with limits" },
      { key: "5", label: "About $5 an episode" },
      { key: "10", label: "About $10 an episode" },
      { key: "20", label: "$20 or more" },
    ],
  },
  { key: "anything", kind: "text", prompt: "Anything else you want us to know?", hint: "Optional.", choices: [] },
];
