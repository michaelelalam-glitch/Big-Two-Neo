/**
 * Fireworks Component Tests
 * Task #424: Unit tests for Fireworks component
 * 
 * Smoke tests to verify component renders correctly
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Fireworks } from '../Fireworks';

// Mock React Native Animated API with proper stop() methods
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  
  const createMockAnimation = (): any => {
    const mockAnim: any = {
      start: jest.fn((callback?: any) => {
        if (callback) callback({ finished: true });
        return mockAnim;
      }),
      stop: jest.fn(),
      reset: jest.fn(),
      _value: 0,
    };
    return mockAnim;
  };
  
  return {
    ...RN,
    Animated: {
      ...RN.Animated,
      timing: jest.fn(() => createMockAnimation()),
      delay: jest.fn(() => createMockAnimation()),
      sequence: jest.fn(() => createMockAnimation()),
      parallel: jest.fn(() => createMockAnimation()),
      loop: jest.fn((anim) => createMockAnimation()),
      Value: jest.fn(() => ({
        setValue: jest.fn(),
        interpolate: jest.fn(() => ({
          _value: 0,
        })),
        stopAnimation: jest.fn(),
        _value: 0,
      })),
    },
  };
});

describe('Fireworks Component', () => {
  describe('Basic Rendering', () => {
    it('returns null when inactive', () => {
      const { toJSON } = render(<Fireworks active={false} />);
      expect(toJSON()).toBeNull();
    });

    it('renders without errors when active', () => {
      const { toJSON } = render(<Fireworks active={true} />);
      expect(toJSON()).toBeTruthy();
    });

    it('renders without errors with custom duration', () => {
      const { toJSON } = render(<Fireworks active={true} duration={3000} />);
      expect(toJSON()).toBeTruthy();
    });
  });
});
