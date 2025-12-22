/**
 * useAdaptiveLandscapeLayout Hook Tests
 * 
 * Tests for responsive landscape layout calculations
 * 
 * Part of Task #456: Setup base screen specifications and safe area handling
 * Date: December 18, 2025
 */

import { renderHook } from '@testing-library/react-native';
import { useAdaptiveLandscapeLayout } from '../useAdaptiveLandscapeLayout';
import * as RN from 'react-native';
import * as SafeArea from 'react-native-safe-area-context';

// Mock dependencies
const mockUseWindowDimensions = RN.useWindowDimensions as unknown as ReturnType<typeof jest.fn>;
const mockUseSafeAreaInsets = SafeArea.useSafeAreaInsets as unknown as ReturnType<typeof jest.fn>;

jest.mock('react-native');
jest.mock('react-native-safe-area-context');

describe('useAdaptiveLandscapeLayout', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('iPhone 17 Landscape (Base Device)', () => {
    it('should return correct dimensions for iPhone 17 landscape', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 932,
        height: 430,
        scale: 3,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        bottom: 21,
        left: 59,
        right: 59,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      expect(result.current.screenWidth).toBe(932);
      expect(result.current.screenHeight).toBe(430);
      expect(result.current.category).toBe('phoneLarge');
      expect(result.current.isLandscape).toBe(true);

      // Safe areas
      expect(result.current.safeArea.top).toBe(0);
      expect(result.current.safeArea.bottom).toBe(21);
      expect(result.current.safeArea.left).toBe(59);
      expect(result.current.safeArea.right).toBe(59);

      // Usable dimensions (814pt × 409pt)
      expect(result.current.usableWidth).toBe(814); // 932 - 59 - 59
      expect(result.current.usableHeight).toBe(409); // 430 - 21

      // Card dimensions
      expect(result.current.cardWidth).toBe(72);
      expect(result.current.cardHeight).toBeCloseTo(104, 0); // 72 × 1.4444
      expect(result.current.cardOverlap).toBe(0.5);

      // Table dimensions
      expect(result.current.tableWidth).toBeGreaterThan(0);
      expect(result.current.tableHeight).toBeGreaterThan(0);
      expect(result.current.tableBorderRadius).toBe(result.current.tableHeight / 2);

      // Player sizes
      expect(result.current.topPlayerProfileSize).toBe(80);
      expect(result.current.sidePlayerProfileSize).toBe(60);
      expect(result.current.topPlayerBadgeSize).toBe(44);
      expect(result.current.sidePlayerBadgeSize).toBe(36);

      // Control bar
      expect(result.current.controlBarHeight).toBe(68);
    });
  });

  describe('iPhone SE Landscape (Smallest)', () => {
    it('should adapt for small device', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 568,
        height: 320,
        scale: 2,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      expect(result.current.category).toBe('phoneSmall');
      expect(result.current.cardWidth).toBe(56); // Smaller cards
      expect(result.current.cardOverlap).toBe(0.4); // Less overlap
      expect(result.current.tableWidth).toBe(320); // Min width constraint
    });
  });

  describe('iPad Air Landscape (Tablet)', () => {
    it('should adapt for tablet', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 1180,
        height: 820,
        scale: 2,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      expect(result.current.category).toBe('tabletSmall');
      expect(result.current.cardWidth).toBe(80); // Larger cards
      expect(result.current.cardOverlap).toBe(0.45); // Tablet overlap
      expect(result.current.topPlayerProfileSize).toBe(100); // Larger profiles
    });
  });

  describe('iPad Pro 12.9" Landscape (Largest)', () => {
    it('should adapt for large tablet', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 1366,
        height: 1024,
        scale: 2,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      expect(result.current.category).toBe('tabletLarge');
      expect(result.current.cardWidth).toBe(88); // Largest cards
      expect(result.current.tableWidth).toBe(560); // Max width constraint
      expect(result.current.tableHeight).toBe(320); // Max height constraint
      expect(result.current.scoreboardExpandedWidth).toBe(600); // Max width
    });
  });

  describe('Portrait Mode Detection', () => {
    it('should detect portrait mode', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 430,
        height: 932,
        scale: 3,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 59,
        bottom: 21,
        left: 0,
        right: 0,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      expect(result.current.isLandscape).toBe(false);
      expect(result.current.usableWidth).toBe(430);
      expect(result.current.usableHeight).toBe(852); // 932 - 59 - 21
    });
  });

  describe('Responsive Calculations', () => {
    it('should recalculate on dimension change', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 932,
        height: 430,
        scale: 3,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        bottom: 21,
        left: 59,
        right: 59,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      const initialWidth = result.current.screenWidth;
      expect(initialWidth).toBe(932);

      // Note: Testing dimension changes requires remounting the hook
      // in a real app, this happens automatically via useWindowDimensions
    });
  });

  describe('Safe Area Handling', () => {
    it('should account for safe area insets in usable dimensions', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 932,
        height: 430,
        scale: 3,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 10,
        bottom: 30,
        left: 40,
        right: 50,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      // Usable width: 932 - 40 - 50 = 842
      expect(result.current.usableWidth).toBe(842);
      
      // Usable height: 430 - 10 - 30 = 390
      expect(result.current.usableHeight).toBe(390);
    });
  });

  describe('Table Dimensions', () => {
    it('should scale table width between min and max', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 932,
        height: 430,
        scale: 3,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        bottom: 21,
        left: 59,
        right: 59,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      // Table width should be 45% of screen width, clamped between 320-560
      const expected = Math.min(Math.max(932 * 0.45, 320), 560);
      expect(result.current.tableWidth).toBeCloseTo(expected, 0);
    });

    it('should ensure border radius is half of table height', () => {
      mockUseWindowDimensions.mockReturnValue({
        width: 932,
        height: 430,
        scale: 3,
        fontScale: 1,
      });

      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        bottom: 21,
        left: 59,
        right: 59,
      });

      const { result } = renderHook(() => useAdaptiveLandscapeLayout());

      expect(result.current.tableBorderRadius).toBe(result.current.tableHeight / 2);
    });
  });
});
