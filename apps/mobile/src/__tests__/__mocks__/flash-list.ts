/**
 * Jest mock for @shopify/flash-list.
 * FlashList uses native modules that are unavailable in Node.js test environment.
 * We forward to React Native's FlatList which is already mocked for Jest.
 */
import React from 'react';
import { FlatList } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FlashList = React.forwardRef((props: any, ref: any) =>
  React.createElement(FlatList, { ...props, ref })
);
FlashList.displayName = 'FlashList';

export interface FlashListRef<T> {
  scrollToEnd: (params?: { animated?: boolean }) => void;
  scrollToIndex: (params: { index: number; animated?: boolean }) => void;
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
  scrollToItem: (params: { item: T; animated?: boolean }) => void;
}
