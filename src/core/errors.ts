/** A file-level problem (missing file, missing column, broken quoting). Bad individual rows are never a LoadError. */
export class LoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadError';
  }
}
