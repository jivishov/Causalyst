import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, AudioLines, Check, FileText, MessageCircle, Orbit } from "lucide-react";
import { Link } from "react-router-dom";
import { ExplainLogo } from "./ExplainLogo";
import { GasExample } from "./GasExample";

const FORMATS = [
  { id: "simulation", label: "Simulation", Icon: Orbit, summary: "Turn an explanation into something you can test.", action: "Describe how a system works, generate a visual model, and refine it to match your reasoning.", evidence: "Your explanation and the simulation you developed.", example: "How does changing the volume of a gas affect its pressure?" },
  { id: "writing", label: "Writing", Icon: FileText, summary: "Develop your reasoning in a written response.", action: "Read the prompt and upload your written work in a format accepted by your teacher.", evidence: "Your uploaded response, assessed against the assignment rubric.", example: "Use a research finding to propose a question you could investigate." },
  { id: "voice", label: "Voice message", Icon: AudioLines, summary: "Explain an idea in your own words.", action: "Record your explanation, listen back, and submit when you are ready.", evidence: "Your recorded explanation and its transcript for review.", example: "Explain why atoms form chemical bonds, using an example." },
  { id: "live", label: "Live conversation", Icon: MessageCircle, summary: "Talk through an idea with follow-up questions.", action: "Join a live voice assessment and explain your reasoning as the conversation develops.", evidence: "A record of the conversation for assessment and teacher review.", example: "Talk through how energy moves through a food web." }
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
            <span className="frontpage-eyebrow"><span />A workspace for your understanding</span>
            <h1 id="frontpage-title">Explain your thinking.<br /><em>Build understanding.</em></h1>
            <p className="frontpage-lead">Explain ideas, create evidence, and show what you understand through simulations, writing, and voice.</p>
            <a className="frontpage-explore" href="#assessment-formats">Find your way to express an idea <ArrowDown size={16} /></a>
            {children}
          </div>
          <GasExample />
        </section>

        <section className="frontpage-formats" id="assessment-formats" aria-labelledby="formats-heading">
          <div className="frontpage-section-heading"><div><span className="frontpage-eyebrow">Different formats. Your thinking at the center.</span><h2 id="formats-heading">More than one way to show what you know.</h2></div><span className="frontpage-section-note">Your teacher chooses the format.</span></div>
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
          <div className="frontpage-section-heading"><div><span className="frontpage-eyebrow">From an idea to evidence</span><h2 id="process-heading">A clear path from start to submit.</h2></div><a href="#student-sign-in">Open your workspace <ArrowRight size={16} /></a></div>
          <ol><li><span>01</span><div><h3>Find your assignment</h3><p>Sign in, choose your class, and read the prompt and success criteria.</p></div></li><li><span>02</span><div><h3>Make your thinking visible</h3><p>Build your response in the assigned format. Check it and refine it before submitting.</p></div></li><li><span>03</span><div><h3>Submit and learn from feedback</h3><p>Send your work for review. Read your results and teacher feedback when available.</p></div></li></ol>
          <div className="frontpage-review-note"><Check size={17} /><p><strong>Your reasoning matters.</strong> The assignment rubric guides assessment; your teacher reviews the work and finalizes your grade.</p></div>
        </section>

        <footer className="frontpage-footer"><span className="frontpage-brand"><ExplainLogo size={24} />Explain.az</span><span>Ideas made visible.</span><Link to="/teacher">Teacher workspace <ArrowRight size={14} /></Link></footer>
      </div>
    </main>
  );
}
