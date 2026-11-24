// The app's JSX runs through @offgrid/i18n's runtime, which keeps any element with translate="no" as
// written (what a person or a model wrote, names, code). React Native's props don't declare it, so this
// adds it to Text and TextInput, the elements whose words the runtime translates.
import 'react-native';

declare module 'react-native' {
  interface TextProps {
    translate?: 'yes' | 'no';
  }
  interface TextInputProps {
    translate?: 'yes' | 'no';
  }
}
