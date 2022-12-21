import { getTextBlock } from '../../src/publish-utils/format-utils';

describe('Formatting helpers return expected blocks', () => {
    it('getTextBlock works', () => {
        const blockText = '*Resolved issues:* 15';
        const expected = {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*Resolved issues:* 15',
            },
        };

        const result = getTextBlock(blockText);

        expect(result).toStrictEqual(expected);
    });
});
