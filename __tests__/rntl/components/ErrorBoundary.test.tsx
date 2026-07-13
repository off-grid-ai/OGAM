import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

// A child that throws on render until told otherwise.
const Boom = ({ throwNow }: { throwNow: () => boolean }) => {
  if (throwNow()) throw new Error('boom');
  return <Text>recovered content</Text>;
};

describe('ErrorBoundary', () => {
  it('renders children unchanged when nothing throws', () => {
    const { getByText, queryByTestId } = render(
      <ErrorBoundary>
        <Text>normal content</Text>
      </ErrorBoundary>,
    );
    expect(getByText('normal content')).toBeTruthy();
    expect(queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('shows the recovery fallback (not a white screen) when a child throws', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { getByTestId, getByText } = render(
      <ErrorBoundary>
        <Boom throwNow={() => true} />
      </ErrorBoundary>,
    );
    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByTestId('error-boundary-retry')).toBeTruthy();
    spy.mockRestore();
  });

  it('recovers to children when Try Again is pressed and the child no longer throws', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    const { getByTestId, queryByTestId, getByText } = render(
      <ErrorBoundary>
        <Boom throwNow={() => shouldThrow} />
      </ErrorBoundary>,
    );
    expect(getByTestId('error-boundary-fallback')).toBeTruthy();

    shouldThrow = false;
    fireEvent.press(getByTestId('error-boundary-retry'));

    expect(queryByTestId('error-boundary-fallback')).toBeNull();
    expect(getByText('recovered content')).toBeTruthy();
    spy.mockRestore();
  });
});
