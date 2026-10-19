import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SelectDropdown } from '../../../src/components/SelectDropdown';
import { swallowedByAccessibleAncestor } from '../../utils/screenReader';

describe('SelectDropdown', () => {
  it('closes when the user presses outside the open menu', () => {
    const onChange = jest.fn();
    const ui = render(
      <SelectDropdown
        value="all"
        options={[
          { value: 'all', label: 'All' },
          { value: 'done', label: 'Done' },
        ]}
        onChange={onChange}
        accessibilityLabel="Filter"
        testID="filter"
      />,
    );

    fireEvent.press(ui.getByTestId('filter'));
    expect(ui.getByTestId('filter-option-done')).toBeTruthy();

    fireEvent.press(ui.getByTestId('filter-backdrop'));

    expect(ui.queryByTestId('filter-option-done')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets a screen reader reach each option by its role and label once the menu opens', () => {
    // A settings row owns the value, as every caller does.
    function FilterRow() {
      const [value, setValue] = React.useState('all');
      return (
        <SelectDropdown
          value={value}
          options={[
            { value: 'all', label: 'All' },
            { value: 'done', label: 'Done' },
          ]}
          onChange={setValue}
          accessibilityLabel="Filter"
          testID="filter"
        />
      );
    }
    const ui = render(<FilterRow />);

    // Before: the closed trigger is a collapsed button showing "All", and no option is on screen.
    expect(ui.getByRole('button', { name: 'Filter', expanded: false })).toHaveTextContent('All');
    expect(ui.queryByTestId('filter-option-done')).toBeNull();

    fireEvent.press(ui.getByRole('button', { name: 'Filter' }));

    expect(ui.getByRole('button', { name: 'Filter', expanded: true })).toBeTruthy();
    const all = ui.getByRole('button', { name: 'All', selected: true });
    const done = ui.getByRole('button', { name: 'Done', selected: false });
    // Each option is its own element, not folded into one node for the whole overlay.
    expect(swallowedByAccessibleAncestor(all)).toBeNull();
    expect(swallowedByAccessibleAncestor(done)).toBeNull();

    fireEvent.press(done);

    // The menu closed (the option is gone) and the trigger now shows the choice.
    expect(ui.queryByTestId('filter-option-done')).toBeNull();
    expect(ui.getByRole('button', { name: 'Filter', expanded: false })).toHaveTextContent('Done');
  });
});
