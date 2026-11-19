// Plain-language copy for every failure the API client can report.
import type { ClientError } from '../api';

export interface ErrorCopy {
  title: string;
  message: string;
  /** Offer "Reset to defaults": the URL is the problem. */
  canReset: boolean;
  /** Offer "Try again": asking the same thing again may work. */
  canRetry: boolean;
}

/** The title, message and offered actions for an error. The server's own words are shown unchanged. */
export function describeError(error: ClientError): ErrorCopy {
  switch (error.code) {
    case 'bad_date':
    case 'start_after_end':
    case 'outside_data':
    case 'bad_param':
    case 'unknown_campaign':
    case 'unknown_location':
      return {
        title: "That range or filter can't be used",
        message: error.message,
        canReset: true,
        canRetry: false,
      };
    case 'no_data':
      return {
        title: 'This export has no calls',
        message: error.message,
        canReset: false,
        canRetry: false,
      };
    case 'internal':
      return {
        title: 'The server hit an unexpected error',
        message: 'Try again. If it keeps happening, look at the terminal running npm start.',
        canReset: false,
        canRetry: true,
      };
    case 'network':
    case 'bad_response':
      return {
        title: "Can't reach the data",
        message: error.message,
        canReset: false,
        canRetry: true,
      };
    case 'not_found':
    case 'unknown_view':
      return {
        title: 'Something is missing',
        message: error.message,
        canReset: true,
        canRetry: false,
      };
    default:
      // A code this client does not know (a newer server, or an odd reply). Never leave the screen without copy.
      return { title: 'Something went wrong', message: error.message, canReset: false, canRetry: true };
  }
}
