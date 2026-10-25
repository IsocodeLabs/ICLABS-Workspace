import {
  createNode,
  emptyWorkflow,
  type FormField,
  type Rubric,
  type WorkflowConfig,
} from "@iclabs/core";

/**
 * Processes for the PM and SDE intern roles. Every applicant is invited to "Your details" (the
 * CV, typed out) and "How you think" (written questions, reviewed with a rubric); shortlisted
 * candidates then get a take-home task and one interview (technical + HR). Edit freely in the
 * Process Builder afterwards: scripts/setup-careers-roles.ts only installs these over an
 * untouched starter track, and saves them as builder templates.
 */

const section = (id: string, label: string): FormField => ({
  id,
  label,
  kind: "section",
  required: false,
});
const short = (id: string, label: string, required = true, help?: string): FormField => ({
  id,
  label,
  kind: "short_text",
  required,
  ...(help ? { help } : {}),
});
const long = (
  id: string,
  label: string,
  maxWords: number,
  required = true,
  help?: string,
): FormField => ({
  id,
  label,
  kind: "long_text",
  required,
  maxWords,
  ...(help ? { help } : {}),
});
const link = (
  id: string,
  label: string,
  required = false,
  allowedDomains?: string[],
): FormField => ({
  id,
  label,
  kind: "url",
  required,
  ...(allowedDomains ? { allowedDomains } : {}),
});

type Role = "pm" | "sde";

// ─── Stage 1: Your details ───────────────────────────────────────────────────

function project(n: number, role: Role, required: boolean): FormField[] {
  const what =
    role === "pm"
      ? "What was the problem, who was it for, what did you personally do (research, specs, decisions, launch), and what happened?"
      : "What does it do, what did you personally build, which stack and why, and what was the hardest part?";
  return [
    short(
      `project${n}_name`,
      `Project ${n}: name and one line on what it is`,
      required,
      n === 1
        ? "Start with the one you're proudest of. College, personal, freelance or work projects all count."
        : undefined,
    ),
    long(`project${n}_detail`, `Project ${n}: the details`, 200, required, what),
    link(
      `project${n}_link`,
      role === "pm"
        ? `Project ${n}: link (live product, case study, spec, deck)`
        : `Project ${n}: link (repo, live demo, write-up)`,
    ),
  ];
}

function detailsFields(role: Role): FormField[] {
  return [
    section("s_education", "Education"),
    short("degree", "Degree and branch", true, "e.g. B.Tech, Computer Science"),
    short("college", "College or university"),
    { id: "grad_year", label: "Year you graduate", kind: "number", required: true },
    short("cgpa", "CGPA or percentage", false, "Optional. Add the scale, e.g. 8.4 / 10."),

    section("s_availability", "Availability"),
    short("city", "City you live in now"),
    { id: "available_from", label: "Earliest date you can start", kind: "date", required: true },
    {
      id: "hours",
      label: "Hours a week you can give this internship",
      kind: "single_choice",
      required: true,
      options: ["Under 20", "20–30", "30–40", "Full time (40+)"],
    },

    section("s_projects", role === "pm" ? "Products and projects" : "Projects"),
    ...project(1, role, true),
    ...project(2, role, true),
    ...project(3, role, false),

    section("s_experience", "Experience"),
    long(
      "experience",
      "Internships, jobs, freelance work or open source",
      300,
      false,
      "For each: role, organisation, dates, what you owned and what came of it. Leave empty if you haven't had any yet.",
    ),
    long(
      "achievements",
      "Achievements, competitions, hackathons and positions of responsibility",
      200,
      false,
    ),

    section("s_skills", "Skills and links"),
    long(
      "skills",
      role === "pm"
        ? "Tools and skills you actually use"
        : "Languages, frameworks and tools you're comfortable with",
      120,
      true,
      role === "pm"
        ? "e.g. user interviews, Figma, SQL, Mixpanel, Notion, Jira. Only list what you'd be happy to be asked about."
        : "Put the ones you'd be happy to be quizzed on first.",
    ),
    role === "sde"
      ? link("github", "GitHub profile", true, ["github.com"])
      : link("portfolio", "Portfolio, blog or case studies"),
    link("linkedin", "LinkedIn profile"),
    role === "sde"
      ? link("portfolio", "Portfolio, blog or personal site")
      : link("github", "GitHub profile, if you have one"),
  ];
}

// ─── Stage 2: How you think ──────────────────────────────────────────────────

const doneOptions: Record<Role, string[]> = {
  pm: [
    "Interviewed users for research",
    "Written a PRD or spec that got built",
    "Shipped a feature or product to real users",
    "Run an A/B test or experiment",
    "Written SQL to answer a question",
    "Used product analytics (Mixpanel, Amplitude, GA)",
    "Designed screens or flows in Figma",
    "Built something with an LLM API or AI tool",
  ],
  sde: [
    "Deployed an app to a cloud provider",
    "Written automated tests",
    "Reviewed someone else's pull request",
    "Had my pull request reviewed by others",
    "Designed a SQL database schema",
    "Set up CI/CD",
    "Debugged an issue in production",
    "Built a feature on an LLM API",
    "Contributed to open source",
  ],
};

function thinkingFields(role: Role): FormField[] {
  const pm = role === "pm";
  return [
    {
      id: "s_how",
      label: "How to answer",
      kind: "section",
      required: false,
      help: [
        "• Specific beats impressive. A real example from a college project tells us more than a polished general answer.",
        "• 100–250 words per answer is plenty. Each box shows its word limit.",
        "• Write it yourself. Use AI the way you normally work if you like, but these answers are about you, and we'll talk about them later.",
        "• Your answers save as you type, so you can come back before the deadline.",
      ].join("\n"),
    },
    section("s_story", "Your story"),
    long(
      "story",
      pm
        ? "Walk us through your story so far. What drew you to product, and which 2–3 decisions got you here?"
        : "Walk us through your story with software. How did you start, what have you built since, and what are you trying to get better at now?",
      250,
    ),
    long(
      "failure",
      "Tell us about something you built or ran that didn't go to plan. What happened, what was your part in it, and what would you do differently?",
      250,
    ),
    long(
      "changed_mind",
      pm
        ? "What's an opinion about products or how teams work that you've changed your mind on? What changed it?"
        : "What's a technical opinion you've changed your mind on (a tool, a practice, a way of building)? What changed it?",
      200,
    ),

    section("s_approach", pm ? "How you approach product work" : "How you approach engineering"),
    ...(pm
      ? [
          long(
            "product_teardown",
            "Pick a product you use every week. Who is it really for, what's one thing you'd change, and how would you know the change worked?",
            300,
          ),
          long(
            "launch_pressure",
            "You're the PM on a 3-person team, two weeks from a launch. Your most important customer asks for a feature that isn't in the plan. Walk us through your first 48 hours.",
            250,
          ),
          long(
            "what_not_to_build",
            "How do you decide what not to build? Use a real example if you have one.",
            200,
          ),
          long(
            "estimate_gap",
            "Engineering says something will take six weeks. The founder wants it in two. What do you do?",
            200,
          ),
        ]
      : [
          long(
            "hardest_problem",
            "Tell us about the hardest bug or technical problem you've solved. What made it hard, how did you narrow it down, and what was the fix?",
            300,
          ),
          long(
            "new_codebase",
            "You join a 100,000-line codebase you've never seen and get a bug report about a feature you don't know. Walk us through your first two days.",
            250,
          ),
          long(
            "tradeoff",
            "Describe a technical choice between two reasonable options (a library, a data model, an architecture). What were the trade-offs, and what did you pick?",
            250,
          ),
          long(
            "definition_of_done",
            "What does “done” mean to you for a feature? What do you check before you call it shipped?",
            200,
          ),
        ]),

    section("s_production", pm ? "Shipping with a team" : "Production and team codebases"),
    ...(pm
      ? [
          long(
            "shipped_with_engineers",
            "Tell us about a time you worked with engineers or designers on something real users used. What was your role, and what did you learn about working with them?",
            250,
            true,
            "If you haven't shipped to real users yet, tell us about the closest thing (a college project, a hackathon, a club) and what you'd want to learn.",
          ),
          long(
            "metrics",
            "How did you (or would you) find out whether something you shipped was working? Which numbers, which conversations?",
            200,
          ),
        ]
      : [
          long(
            "production",
            "Have you shipped code that real users used? Tell us about it: how many users, how it was deployed, and how you knew it was working.",
            250,
            true,
            "If not yet, say so, and tell us what you'd most want to learn about running software in production.",
          ),
          long(
            "team_codebase",
            "Have you worked in a codebase with other developers? How did you split the work, review each other's code, and handle merge conflicts or disagreements in review?",
            250,
          ),
          long(
            "something_broke",
            "Tell us about a time something broke at the worst moment (in production, at a demo, before a deadline). What did you do?",
            200,
          ),
        ]),
    long(
      "disagreement",
      "Describe a real disagreement with a teammate or someone senior. What was it about, and how did it end?",
      200,
    ),

    section("s_ai", "Building with AI"),
    long(
      "ai_workflow",
      pm
        ? "How do you use AI in your work today? Be specific: which tools, what you hand over to it, what you never hand over, and where it's let you down."
        : "How do you use AI when you code? Which tools, what you let it write, how you check its output, and a time it confidently got something wrong.",
      250,
    ),
    long(
      "ai_feature",
      pm
        ? "You're adding an AI feature to a product used by clinics, e.g. drafting patient notes. How do you decide it's good enough to ship, and what do you watch after launch?"
        : "You're building a feature that sends a user's document to an LLM and shows them a summary. What would worry you before shipping, and how would you test it?",
      250,
    ),

    section("s_you", "About you"),
    {
      id: "done_list",
      label: "Which of these have you done yourself?",
      kind: "multi_choice",
      required: false,
      options: doneOptions[role],
      help: "Tick only what you've actually done. We may ask about any of them.",
    },
    long("energy", "What kind of work makes you lose track of time? What drains you?", 150),
    long(
      "three_years",
      "Where do you want to be in three years, and how does this internship fit into that?",
      150,
    ),
    long(
      "anything_else",
      "Is there anything else you want us to know about you, your circumstances or your application?",
      150,
      false,
    ),
  ];
}

function thinkingRubric(role: Role): Rubric {
  const c = (
    id: string,
    name: string,
    weight: number,
    description: string,
    anchors: [string, string, string],
  ) => ({
    id,
    name,
    weight,
    description,
    anchors: { "1": anchors[0], "3": anchors[1], "5": anchors[2] },
  });
  return {
    scale: "1-5",
    criteria: [
      c(
        "clarity",
        "Clarity of thinking",
        role === "pm" ? 30 : 20,
        "Structures answers, gets to the point, reasons from specifics.",
        [
          "Vague or generic; restates the question",
          "Clear but surface-level",
          "Crisp, structured, specific examples and trade-offs",
        ],
      ),
      role === "pm"
        ? c(
            "judgement",
            "Product judgement",
            25,
            "Understands users, priorities and how to tell if something worked.",
            [
              "Feature lists, no user or outcome",
              "Sensible but textbook",
              "Sharp user insight, says no, measures outcomes",
            ],
          )
        : c(
            "depth",
            "Engineering depth",
            30,
            "Real technical understanding: debugging, trade-offs, quality.",
            [
              "Buzzwords, no detail",
              "Solid on what they've done",
              "Explains why, not just what; knows the limits",
            ],
          ),
      c(
        "production",
        role === "pm" ? "Working with a team" : "Production and teamwork",
        20,
        role === "pm"
          ? "Has shipped with engineers/designers, or clearly understands how to."
          : "Has worked in shared codebases and/or run code for real users.",
        [
          "No exposure and no curiosity",
          "Some exposure, learning",
          "Has shipped, reviewed, handled incidents",
        ],
      ),
      c(
        "ownership",
        "Ownership and self-awareness",
        role === "pm" ? 15 : 15,
        "Owns failures, learns, knows their strengths and gaps.",
        [
          "Blames others or claims no failures",
          "Honest but shallow reflection",
          "Specific lessons, changed behaviour",
        ],
      ),
      c(
        "ai",
        "Building with AI",
        role === "pm" ? 10 : 15,
        "Uses AI deliberately and knows where it fails.",
        [
          "Doesn't use it, or trusts it blindly",
          "Uses it day to day",
          "Clear workflow, verifies output, thinks about risks",
        ],
      ),
    ],
  };
}

// ─── Processes ───────────────────────────────────────────────────────────────

/**
 * Details → How you think → Take-home task → Interview. Everyone invited does the first two.
 * The task and interview are only for candidates the team shortlists, and candidates see only
 * their names until then: no descriptions here, and a stage can't be opened before it's unlocked.
 */
function roleProcess(role: Role, interviewerPool: string[]): WorkflowConfig {
  const details = createNode("form", {
    id: "details",
    title: "Your details",
    description:
      "Tell us about yourself: your education, availability and everything on your CV, in your own words. Projects matter most, so give them the most detail. Takes about 20 minutes.",
    deadline: { mode: "relative", daysAfterUnlock: 3, atTime: "23:59" },
  });
  details.config.fields = detailsFields(role);

  const thinking = createNode("custom", {
    id: "how_you_think",
    title: "How you think",
    description: `Written questions about how you think about ${role === "pm" ? "product" : "engineering"} work and the story behind your CV. No trick questions and no right answers. Takes about 60–90 minutes.`,
    deadline: { mode: "relative", daysAfterUnlock: 4, atTime: "23:59" },
  });
  thinking.config = { fields: thinkingFields(role), reviewed: true };
  thinking.rubric = thinkingRubric(role);
  thinking.reviewers = { pool: [], perSubmission: 1, method: "round_robin", blind: false };
  // Everyone who finishes this step is told to get ready for the task round.
  thinking.emails = { submitted: "task_prepare" };

  // Shortlisted candidates only. Write the brief in the Process Builder before moving anyone here.
  const task = createNode("task", {
    id: "task",
    title: "Take-home task",
    deadline: { mode: "relative", daysAfterUnlock: 5, atTime: "23:59" },
  });
  task.config = {
    brief: "",
    deliverables: [
      { id: "work_link", kind: "link", label: "Link to your work", required: true },
      { id: "work_file", kind: "file", label: "Supporting file (optional)", required: false },
      {
        id: "work_notes",
        kind: "text",
        label: "Anything you want us to know about your submission",
        required: false,
      },
    ],
    allowResubmit: true,
  };

  const interview = createNode("interview", { id: "interview", title: "Interview" });
  interview.config = { roundName: "Interview", durationMin: 60, interviewerPool, mode: "meet" };

  return {
    ...emptyWorkflow(),
    nodes: [details, thinking, task, interview],
    edges: [
      {
        id: "details_next",
        from: "details",
        to: "how_you_think",
        priority: 0,
        when: { always: true },
      },
      // The team shortlists: everyone waits for a decision and shortlisted candidates are moved
      // to the task ("Move to…" in the pipeline, in bulk too). The second rule never fires; it
      // keeps the task and interview on the candidate's timeline (by name only). Put it first in
      // the builder to shortlist automatically when every reviewer says yes.
      {
        id: "shortlist_wait",
        from: "how_you_think",
        to: "NEEDS_DECISION",
        priority: 0,
        when: { always: true },
      },
      {
        id: "shortlist_auto",
        from: "how_you_think",
        to: "task",
        priority: 1,
        when: { consensus: "all_yes" },
      },
      // A solid task goes to "Ready to schedule"; the team still books each interview.
      {
        id: "task_pass",
        from: "task",
        to: "interview",
        priority: 0,
        when: { metric: "rubric_pct", op: ">=", value: 60 },
      },
      {
        id: "task_low",
        from: "task",
        to: "END_REJECT",
        priority: 1,
        when: { metric: "rubric_pct", op: "<", value: 40 },
      },
      { id: "task_else", from: "task", to: "NEEDS_DECISION", priority: 2, when: { always: true } },
      {
        id: "interview_next",
        from: "interview",
        to: "NEEDS_DECISION",
        priority: 0,
        when: { always: true },
      },
    ],
  };
}

export const ROLE_PROCESSES: Record<
  string,
  { template: string; description: string; build: (interviewerPool: string[]) => WorkflowConfig }
> = {
  "product-manager-intern": {
    template: "PM intern process",
    description:
      "Your details → How you think (reviewed) → Take-home task → Interview. Task and interview are for shortlisted candidates.",
    build: (pool) => roleProcess("pm", pool),
  },
  "software-engineering-intern": {
    template: "SDE intern process",
    description:
      "Your details → How you think (reviewed) → Take-home task → Interview. Task and interview are for shortlisted candidates.",
    build: (pool) => roleProcess("sde", pool),
  },
};
