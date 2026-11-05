import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { ListGroup, ListGroupSeparator, listGroupRowEnds } from '../../../src/components/ListGroup';

describe('ListGroup', () => {
  it('shows every row once, in order, and skips empty children', () => {
    const { getAllByText } = render(
      <ListGroup testID="group">
        <Text>Alpha</Text>
        {null}
        <Text>Beta</Text>
        {false}
        <Text>Gamma</Text>
      </ListGroup>,
    );
    expect(getAllByText(/Alpha|Beta|Gamma/).map(n => n.props.children)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('renders a separator for a virtualized list', () => {
    expect(() => render(<ListGroupSeparator />)).not.toThrow();
  });

  it('rounds only the outer corners of the first and last rows', () => {
    expect(listGroupRowEnds(0, 3)).toEqual({ borderTopLeftRadius: 12, borderTopRightRadius: 12 });
    expect(listGroupRowEnds(1, 3)).toEqual({});
    expect(listGroupRowEnds(2, 3)).toEqual({ borderBottomLeftRadius: 12, borderBottomRightRadius: 12 });
    expect(listGroupRowEnds(0, 1)).toEqual({
      borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
    });
  });
});
