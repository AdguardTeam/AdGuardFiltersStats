import {
    MAX_ERROR_MESSAGE_LENGTH,
    normalizeErrorMessage,
} from '../../src/tools/error-utils';

describe('normalizeErrorMessage', () => {
    it('collapses a multi-line message into one line', () => {
        const message = 'Request failed\n\n  with a body:\n<html>\n</html>';

        expect(normalizeErrorMessage(message)).toBe(
            'Request failed with a body: <html> </html>',
        );
    });

    it('reads the message of an error object', () => {
        expect(normalizeErrorMessage(new Error('boom\nthere'))).toBe('boom there');
    });

    it('accepts a thrown value that is not an error', () => {
        expect(normalizeErrorMessage('plain')).toBe('plain');
        expect(normalizeErrorMessage(404)).toBe('404');
    });

    it('returns an empty string when the value carries no message', () => {
        expect(normalizeErrorMessage(null)).toBe('');
        expect(normalizeErrorMessage(undefined)).toBe('');
        expect(normalizeErrorMessage(new Error())).toBe('');
    });

    it('returns an empty string for a value without a primitive conversion', () => {
        // The helper runs inside catch blocks, so it must not throw here.
        expect(normalizeErrorMessage(Object.create(null))).toBe('');
    });

    it('does not split a surrogate pair at the cut', () => {
        const emoji = '😀';
        const message = `${'a'.repeat(MAX_ERROR_MESSAGE_LENGTH - 4)}${emoji}tail`;

        const result = normalizeErrorMessage(message);

        expect(result).toBe(`${'a'.repeat(MAX_ERROR_MESSAGE_LENGTH - 4)}...`);
        expect(result).toHaveLength(MAX_ERROR_MESSAGE_LENGTH - 1);
    });

    it('keeps a message at the limit unchanged', () => {
        const message = 'b'.repeat(MAX_ERROR_MESSAGE_LENGTH);

        expect(normalizeErrorMessage(message)).toBe(message);
    });

    it('bounds a message longer than the limit', () => {
        const result = normalizeErrorMessage('a'.repeat(MAX_ERROR_MESSAGE_LENGTH * 2));

        expect(result).toHaveLength(MAX_ERROR_MESSAGE_LENGTH);
        expect(result.endsWith('...')).toBe(true);
    });
});
