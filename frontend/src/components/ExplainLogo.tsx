/** Shared vector identity for landing pages, workspaces, and the favicon. */
export function ExplainLogo({ size = 32 }: { size?: number }) {
  return <img className="explain-logo" src={`${import.meta.env.BASE_URL}explain-logo.svg`} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
