import {
  DEFAULT_WRITING_ACCEPTED_MIME,
  DEFAULT_WRITING_MAX_BYTES
} from "./assessmentConfig";
import type { AssessmentType, RubricCriterion } from "./types";

export interface AssessmentTemplate {
  id: string;
  label: string;
  description: string;
  type: AssessmentType;
  title: string;
  prompt: string;
  expectedAnswer: string;
  rubric: RubricCriterion[];
  config: Record<string, unknown>;
}

const findingToQuestionPrompt = `Read the results/conclusion paragraph below. It describes a scientific finding, but it does not give the original research question. Work backward to create a researchable question that could have produced the finding.

Stimulus paragraph:
Bean seedlings grown for four weeks in soil mixed with 20% compost were taller and produced more leaf area than seedlings grown in standard potting soil. Both groups received the same light and water. Soil tests showed higher nitrate levels in the compost pots. The researchers concluded that compost improved early bean growth, likely by increasing nutrient availability.

Complete each scaffolded section in your uploaded response.

1. Main finding: State the paragraph's main scientific finding in one sentence.
2. Evidence constraints: List 2 details from the paragraph your question must match.
3. Scientific elements: Identify the system/population, factor or condition, measurable outcome, comparison/control, and context/timeframe if present.
4. Question type: Choose one: effect question, relationship question, or mechanism question.
5. Two drafts: Write two possible research questions.
6. Final question: Revise or select the best question.
7. Testability check: State what data would answer the question and whether the approach is experimental or observational.

Do not simply turn the conclusion into a yes/no question. A strong scientific question names what is measured, what is compared or related, and the system being studied.`;

const findingToQuestionExpectedAnswer = `Teacher answer key

Model main finding:
Bean seedlings grown in soil with 20% compost grew taller and produced more leaf area than seedlings grown in standard potting soil, likely because compost increased nutrient availability.

Required evidence constraints:
- Compost treatment was 20% compost mixed into potting soil.
- Seedlings were bean seedlings grown for four weeks.
- Growth outcomes included height and leaf area.
- Standard potting soil was the comparison/control.
- Both groups received the same light and water.
- Compost pots had higher nitrate levels.

Expected scientific elements:
- System/population: bean seedlings.
- Factor/condition: 20% compost in potting soil, or soil nitrate level for an observational variant.
- Measurable outcome: seedling height, leaf area, or early growth after four weeks.
- Comparison/control: standard potting soil, or comparison across nitrate levels.
- Context/timeframe: four weeks of early seedling growth under the same light and water.

Acceptable final-question versions:
- How does adding 20% compost to potting soil affect bean seedling height and leaf area over four weeks compared with standard potting soil?
- What is the relationship between soil nitrate level and bean seedling growth after four weeks?
- How does compost-related nitrate availability influence early bean seedling height and leaf area?

Common weak answers:
- "Is compost good?" Too vague and not measurable.
- "Why do plants grow?" Too broad and not tied to the finding.
- "Did compost improve bean growth?" Aligned, but mostly restates the conclusion as a yes/no question and does not clearly name the measurements.

Score caps:
- Final question unrelated to the main finding: maximum 10/20.
- Final question not empirically testable: maximum 12/20.
- Final question only restates the conclusion as yes/no: maximum 14/20.
- Missing final question: maximum 8/20.
- Strong final question with incomplete scaffold: no cap; subtract only missing scaffold points.`;

export const FINDING_TO_QUESTION_TEMPLATE: AssessmentTemplate = {
  id: "finding-to-question",
  label: "Finding-to-Question",
  description: "Scaffolded writing assessment for building testable research questions from results and conclusions.",
  type: "writing",
  title: "Finding-to-Question: Building Testable Scientific Questions",
  prompt: findingToQuestionPrompt,
  expectedAnswer: findingToQuestionExpectedAnswer,
  rubric: [
    {
      name: "Finding Accuracy",
      maxPoints: 3,
      description: "Correctly states the main finding without confusing it with a side detail."
    },
    {
      name: "Evidence Constraints",
      maxPoints: 3,
      description: "Uses paragraph details that the final question must preserve."
    },
    {
      name: "Scientific Elements",
      maxPoints: 4,
      description: "Correctly identifies the system, factor or predictor, measurable outcome, and comparison or context where available."
    },
    {
      name: "Question Construction",
      maxPoints: 4,
      description: "Drafts are scientific questions, not claims; they are focused and move toward measurable wording."
    },
    {
      name: "Final Question",
      maxPoints: 4,
      description: "Final question is aligned, specific, measurable, and empirically answerable. Apply these caps to the total score: unrelated to the main finding max 10/20; not empirically testable max 12/20; conclusion restated as yes/no max 14/20; missing final question max 8/20."
    },
    {
      name: "Testability Check",
      maxPoints: 2,
      description: "Names the data needed and identifies experiment or observation appropriately."
    }
  ],
  config: {
    acceptedMime: [...DEFAULT_WRITING_ACCEPTED_MIME],
    maxBytes: DEFAULT_WRITING_MAX_BYTES
  }
};

export const ASSESSMENT_TEMPLATES = [
  FINDING_TO_QUESTION_TEMPLATE
] as const;
