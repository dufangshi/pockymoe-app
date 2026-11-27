// The few React Native exports that pure design code reads, for Node tests.
export const Platform = { OS: 'android', select: <T,>(o: { android?: T; default?: T }) => o.android ?? o.default };
export const useColorScheme = () => 'light';
