import React from 'react';
import Svg, { Path, type SvgProps } from 'react-native-svg';

// Same Ares artwork as Desktop; the host control supplies its theme and active color.
export const GodIcon: React.FC<SvgProps & { size?: number }> = ({
  size = 20, color = 'currentColor', ...props
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    accessible={false}
    {...props}
  >
    <Path d="M9.8 3.4C13.6 1.3 17.7 2.1 20.5 4.7C18.9 5.2 17.3 6.9 17 8.1C15.6 6.5 13 6.9 11.3 7.4C8.6 8.2 7.1 10.9 7.6 14.9C6.1 15.5 5.5 17.4 5 19.5C4.8 20.1 4 20.6 3.2 20.8C4.5 19.3 4.2 17.6 4.8 15.6L4.1 16.8C2.7 13.4 3.7 10.6 6.9 7.9C5.4 8.5 4.5 9.4 3.8 10.6C4.5 7.5 6.3 4.8 9 3.7C10.8 3.5 12.4 4.6 13.4 5.7C12.7 4.3 11.4 3.7 9.8 3.4Z" />
    <Path d="M18.2 10.4C16.7 7.9 14.9 7.4 12.3 8.2C9.4 9.1 7.8 11.5 8.1 14.3C8.2 15.6 9 16.9 8.7 18C8.6 18.3 8.2 18.9 8 19.2C9.8 18.9 10.5 17.4 11.2 16C11.5 15.2 12.2 15.1 12.5 16L13.1 18.2L18.8 21.5L17.8 15.8C16.4 15.4 15.6 14.3 14.6 13L13.2 12.2C15.2 11.9 17 11.2 18.2 10.4Z" />
    <Path
      fillRule="evenodd"
      d="M18.5 10.3L20.3 16.1L19.1 15.4L19.2 17.7L18.6 19.1L17.7 15.8C16.6 15.4 15.5 14.2 14.6 13L13.2 12.2C15.6 11.7 17.6 10.8 18.5 10.3ZM15.9 12.7L16.8 13.8L18.8 14.6L18.7 13.5Z"
    />
  </Svg>
);
