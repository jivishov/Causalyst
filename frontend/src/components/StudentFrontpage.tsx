import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, AudioLines, FileText, MessageCircle, Orbit } from "lucide-react";
import { Link } from "react-router-dom";
import { ExplainLogo } from "./ExplainLogo";
import { GasExample } from "./GasExample";

const FORMATS = [
  { id: "simulation", label: "Simulation", Icon: Orbit, summary: "Make your explanation visible in a model.", action: "Describe how a system works. AI helps build a simulation; test predictions, compare it with what you have learned, and refine your explanation.", evidence: "Your explanation and the simulation saved with your submission.", example: "For a fixed amount of gas at constant temperature, how does changing its volume affect pressure?" },
  { id: "writing", label: "Writing", Icon: FileText, summary: "Develop your reasoning in a written response.", action: "Read the prompt, explain your reasoning, and upload your written work using a file type allowed for the assignment.", evidence: "Your uploaded written response.", example: "Use a research finding to propose a question you could investigate." },
  { id: "voice", label: "Voice message", Icon: AudioLines, summary: "Explain an idea in your own words.", action: "Record your explanation, listen back, and retake it if needed before submitting.", evidence: "Your audio recording. A transcript supports assessment and teacher review.", example: "Explain why atoms form chemical bonds, using an example." },
  { id: "live", label: "Live conversation", Icon: MessageCircle, summary: "Explain your reasoning in a live AI conversation.", action: "Start a live voice assessment with AI. Explain your answers and respond to follow-up questions when clarification is needed.", evidence: "The conversation transcript for assessment and teacher review.", example: "Explain how energy moves through a food web and why less energy reaches higher trophic levels." }
] as const;

export function StudentFrontpage({ children }: { children: ReactNode }) {
  const [selectedFormat, setSelectedFormat] = useState(0);
  const selected = FORMATS[selectedFormat];

  function moveFormat(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % FORMATS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + FORMATS.length - 1) % FORMATS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FORMATS.length - 1;
    else return;
    event.preventDefault();
    setSelectedFormat(next);
    document.getElementById(`format-${FORMATS[next].id}`)?.focus();
  }

  return (
    <main className="student-frontpage">
      <a className="frontpage-skip" href="#student-sign-in">Skip to student sign-in</a>
      <div className="frontpage-wrap">
        <header className="frontpage-nav">
          <Link to="/" className="frontpage-brand" aria-label="Explain.az home"><ExplainLogo size={36} />Explain.az</Link>
          <nav aria-label="Frontpage navigation"><a href="#assessment-formats">Assessment formats</a><a href="#how-it-works">How it works</a><Link className="frontpage-teacher-link" to="/teacher">For teachers <ArrowRight size={15} /></Link></nav>
        </header>

        <section className="frontpage-hero" aria-labelledby="frontpage-title">
          <div className="frontpage-intro">
            <span className="frontpage-eyebrow"><span />Learn by explaining</span>
            <h1 id="frontpage-title"><span>Explain your thinking.</span>{" "}<span>See your ideas.</span>{" "}<em>Deepen your understanding.</em></h1>
            <p className="frontpage-lead">Explain how and why things happen through simulations, writing, and voice. Explore your ideas, check your reasoning, and learn from feedback.</p>
            <a className="frontpage-explore" href="#assessment-formats">Explore the assessment formats <ArrowDown size={16} /></a>
            {children}
          </div>
          <GasExample />
        </section>

        <section className="frontpage-formats" id="assessment-formats" aria-labelledby="formats-heading">
          <div className="frontpage-section-heading"><div><span className="frontpage-eyebrow">Your reasoning, in different formats.</span><h2 id="formats-heading">Different ways to explain what you understand.</h2></div><span className="frontpage-section-note">Your teacher chooses the format.</span></div>
          <div className="frontpage-format-tabs" role="tablist" aria-label="Assessment formats">
            {FORMATS.map((format, index) => <button key={format.id} type="button" role="tab" id={`format-${format.id}`} aria-controls={`format-panel-${format.id}`} aria-selected={selectedFormat === index} tabIndex={selectedFormat === index ? 0 : -1} onClick={() => setSelectedFormat(index)} onKeyDown={event => moveFormat(event, index)}>
              <span className={`frontpage-format-icon format-icon-${format.id}`}><format.Icon size={21} /></span><strong>{format.label}</strong><span>{format.summary}</span><ArrowRight className="frontpage-format-arrow" size={16} aria-hidden="true" />
            </button>)}
          </div>
          <div className="frontpage-format-detail" id={`format-panel-${selected.id}`} role="tabpanel" aria-labelledby={`format-${selected.id}`} tabIndex={0}>
            <div><h3>What you do</h3><p>{selected.action}</p></div><div><h3>What you submit</h3><p>{selected.evidence}</p></div><blockquote><span>Example prompt</span>{selected.example}</blockquote>
          </div>
        </section>

        <section className="frontpage-process" id="how-it-works" aria-labelledby="process-heading">
          <div className="frontpage-section-heading"><div><span className="frontpage-eyebrow">Explain, reflect, improve</span><h2 id="process-heading">From assignment to feedback.</h2></div><a href="#student-sign-in">Go to student sign-in <ArrowRight size={16} /></a></div>
          <ol><li><span>01</span><div><h3>Find your assignment</h3><p>Sign in, choose your class, and read the prompt and rubric to understand what your work should demonstrate.</p></div></li><li><span>02</span><div><h3>Explain and check your reasoning</h3><p>Respond in the assigned format. For simulations, test predictions and compare the model with what you have learned.</p></div></li><li><span>03</span><div><h3>Submit and reflect on feedback</h3><p>Read the feedback when available. Your final grade appears after your teacher publishes it.</p></div></li></ol>
        </section>

        <footer className="frontpage-footer"><span className="frontpage-brand"><ExplainLogo size={24} />Explain.az</span><span>Ideas made visible.</span><Link to="/teacher">Teacher workspace <ArrowRight size={14} /></Link></footer>
      </div>
    </main>
  );
}
