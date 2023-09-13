import packageFunction from '../index';

describe('packageFunction', () => {
    it('should return provided name', async () => {
        const name = 'test';
        expect(packageFunction(name)).toBe(name);
    });
});

