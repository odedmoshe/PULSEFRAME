/**
 * How every Python worker of the server is started.
 * - `-I`: isolated mode — the interpreter ignores PYTHON* variables, the user site and the script's directory when importing, so only
 *   the worker and its installed packages run.
 * - `-X utf8`: UTF-8 mode. Without it, on Windows a piped stdout uses the system code page (cp1252, "charmap"), and a worker that
 *   prints Hebrew — a transcript line, a title, a path — dies with `UnicodeEncodeError: 'charmap' codec can't encode characters`
 *   (the owner's first transcription on 2026-11-26 failed exactly so). `-I` makes Python ignore PYTHONUTF8 and PYTHONIOENCODING, so
 *   the mode must be given on the command line. It also makes stdin and `open()` default to UTF-8.
 */
export const PYTHON_WORKER_FLAGS: readonly string[] = ['-I', '-X', 'utf8'];
