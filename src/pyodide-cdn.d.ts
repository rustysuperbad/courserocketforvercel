declare module "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs" {
  export function loadPyodide(options: { indexURL: string }): Promise<{ runPythonAsync: (code: string) => Promise<unknown> }>;
}
