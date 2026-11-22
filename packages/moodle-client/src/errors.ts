export class MoodleApiError extends Error {
  constructor(
    public errorcode: string,
    message: string,
    public exception?: string
  ) {
    super(message);
    this.name = 'MoodleApiError';
  }
}
