/**
 * Home's Continue card: the next Learn square and today's briefing, only when there is something to resume.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ContinueCard } from '../../../src/screens/HomeScreen/components/ContinueCard';
import { useLanguage } from '../../../src/language/store';
import { useStudyStore } from '../../../src/study/engine';
import { BRIEF_PROJECT } from '../../../src/atlasTools/dailyBrief';
import { boardFor } from '../../../src/language/board';

const navigation = { navigate: jest.fn() };
beforeEach(() => {
  navigation.navigate.mockClear();
  useStudyStore.setState({ saved: {} });
  useLanguage.setState({ language: 'es-ES', level: 1, progress: {}, xp: 0 });
});

it('before the course is started or a briefing made, Home still offers to make the briefing', () => {
  const card = render(<ContinueCard navigation={navigation} />);
  expect(card.queryByTestId('home-continue-learn')).toBeNull();
  fireEvent.press(card.getByTestId('home-continue-briefing-make'));
  expect(navigation.navigate).toHaveBeenCalledWith('DailyBrief');
});

it('offers the next square after the ones done, and opens the course', () => {
  const [first, second] = boardFor(1);
  useLanguage.setState({ xp: 30, progress: { 'es-ES': { [first.key]: { stars: 2, lessons: 1 } } } });
  const card = render(<ContinueCard navigation={navigation} />);
  expect(card.getByText(`Continue Spanish: ${second.title}`)).toBeTruthy();
  fireEvent.press(card.getByTestId('home-continue-learn'));
  expect(navigation.navigate).toHaveBeenCalledWith('Language');
});

it("offers today's briefing and opens it", () => {
  useStudyStore.setState({ saved: { [BRIEF_PROJECT]: [{ kind: 'podcast', createdAt: Date.now(), topic: '', title: 'Daily briefing - Monday', sources: [] }] } } as any);
  const card = render(<ContinueCard navigation={navigation} />);
  fireEvent.press(card.getByTestId('home-continue-briefing'));
  expect(navigation.navigate).toHaveBeenCalledWith('Study', { projectId: BRIEF_PROJECT, openAt: expect.any(Number) });
  expect(card.queryByTestId('home-continue-learn')).toBeNull();
});
