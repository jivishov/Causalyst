// This policy must be inside the Blob document, before any generated element.
// CSP restricts resource loads; sandboxed frame self-navigation is a separate
// browser capability. Do not describe arbitrary generated JS as network-free.
export const SIMULATION_RESOURCE_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
export function protectPreviewDocument(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("base,meta[http-equiv]").forEach((node) => node.remove());
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = SIMULATION_RESOURCE_POLICY;
  document.head.prepend(policy);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
