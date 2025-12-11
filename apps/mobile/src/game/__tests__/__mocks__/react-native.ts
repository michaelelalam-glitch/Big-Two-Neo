// Mock for React Native module in Jest tests
export const Alert = {
  alert: jest.fn(),
};

export const Platform = {
  OS: 'ios',
  select: (obj: any) => obj.ios || obj.default,
};
