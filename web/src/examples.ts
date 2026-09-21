import type { Request } from "./types";

export const EXAMPLES = {
  "Support ticket": {
    state: {
      ticket:
        "I was charged twice for order #4411 and I want my money back. This is the third time I've written, I'm done with you people.",
      customer_since: "2019",
    },
    questions: {
      refund_requested: { type: "noul", instructions: "Is the customer asking for a refund?" },
      is_spam: { type: "noul", instructions: "Is this message spam or an advertisement?" },
      department: {
        type: "choice",
        instructions: "Which team should handle this ticket?",
        criteria: {
          billing: "charges, refunds, invoices",
          shipping: "delivery, tracking, lost parcels",
          returns: "returning or exchanging an item",
          other: null,
        },
      },
      frustration: {
        type: "score",
        instructions: "How frustrated is the customer?",
        criteria: ["calm and polite", "annoyed but civil", "angry, threatening to leave"],
      },
    },
  },
  "Shell command": {
    state: { command: "git push --force origin main", run_by: "an unattended coding agent" },
    questions: {
      writes: {
        type: "noul",
        instructions: "Does this command create, modify or delete anything?",
      },
      reversible: { type: "noul", instructions: "Can its effect be undone easily?" },
      needs_human: { type: "noul", instructions: "Should a person approve this before it runs?" },
      risk: {
        type: "score",
        instructions: "How risky is running this unattended?",
        criteria: ["harmless", "recoverable if wrong", "destructive"],
      },
    },
  },
  "Inbox email": {
    state: {
      from: "noreply@bank-alerts.example",
      subject: "Action required: your account will be suspended",
      body: "We detected unusual activity. Verify your identity within 24 hours by entering your password at the link below or your account will be closed.",
    },
    questions: {
      phishing: { type: "noul", instructions: "Is this email a phishing attempt?" },
      needs_reply: { type: "noul", instructions: "Does the recipient need to reply?" },
      category: {
        type: "choice",
        instructions: "Which folder does this belong in?",
        criteria: {
          personal: null,
          work: null,
          promotions: "marketing and offers",
          alerts: "automated notifications",
          suspicious: "scams and phishing",
        },
      },
      urgency: {
        type: "score",
        instructions: "How urgent is it for the recipient?",
        criteria: ["can wait a week", "this week", "today"],
      },
    },
  },
  "Pull request": {
    state: {
      title: "Move session token check into middleware",
      description:
        "Refactors the per-route auth check into one middleware. No behaviour change intended. Removed the old helper. Tests not updated yet.",
      files_changed: ["src/auth/middleware.py", "src/routes/*.py", "src/auth/helpers.py"],
    },
    questions: {
      touches_auth: {
        type: "noul",
        instructions: "Does this change affect authentication or authorization?",
      },
      needs_tests: {
        type: "noul",
        instructions: "Should tests be added or updated before merging?",
      },
      kind: {
        type: "choice",
        instructions: "What kind of change is this?",
        criteria: {
          fix: "fixes a bug",
          feature: "adds behaviour",
          refactor: "restructures without changing behaviour",
          docs: null,
          chore: "tooling or dependencies",
        },
      },
      review_depth: {
        type: "score",
        instructions: "How carefully should a reviewer read it?",
        criteria: ["skim", "normal review", "line by line, security in mind"],
      },
    },
  },
} satisfies Record<string, Request>;

export type ExampleName = keyof typeof EXAMPLES;

export const EXAMPLE_NAMES = Object.keys(EXAMPLES) as ExampleName[];
