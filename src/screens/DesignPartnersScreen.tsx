import React from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { SPACING, TYPOGRAPHY } from '../constants';
import type { RootStackParamList } from '../navigation/types';
import { useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';

const PARTNER_EMAIL = 'design.partners@getoffgridai.co';
const OFFER = [
  {
    title: 'Free setup and implementation',
    description:
      'Work directly with Mac to identify a problem worth solving and test the solution in your business. Setup and implementation cost you $0.',
  },
  {
    title: 'Free lifetime product access',
    description:
      'If we create a product based even loosely on your input, you get free lifetime access to that product.',
  },
  {
    title: 'Free lifetime Pro if your idea fits',
    description:
      'If your idea is a good fit for Off Grid AI, you get free lifetime Off Grid AI Pro. This applies even if we do not build the full solution together.',
  },
  {
    title: 'Your part: time and feedback',
    description:
      'Show us how you work today. Try what we build in your business. Tell us what works and what needs to change.',
  },
];

export const DesignPartnersScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const styles = useThemedStyles(createStyles);

  const openEmail = async () => {
    const subject = encodeURIComponent('Off Grid AI design partnership');
    const body = encodeURIComponent(
      'Hi Mac,\n\nWhat my business does:\n\nNumber of people on my team:\n\nThe task or process I want to improve:\n\nHow we handle it today:\n\nWhere we get stuck:\n',
    );
    try {
      await Linking.openURL(`mailto:${PARTNER_EMAIL}?subject=${subject}&body=${body}`);
    } catch {
      Alert.alert('Could not open mail', `Email ${PARTNER_EMAIL} with your business, team size, and the task you want to improve. You can copy the address from this screen.`);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Design partners"
        onBack={() => {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.replace('ProDetail');
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">Build around your work. Pay $0.</Text>
        <Text style={styles.body}>
          For small businesses with fewer than 50 people. Ideally, we work
          directly with an owner or someone who can choose and test a solution.
        </Text>
        {OFFER.map(item => (
          <View key={item.title} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">{item.title}</Text>
            <Text style={styles.body}>{item.description}</Text>
          </View>
        ))}
        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">Is this a fit for my business?</Text>
          <Text style={styles.body}>
            We are looking for recurring problems that would normally justify
            spending $99-$999 per month to solve. As a design partner, your cost
            is $0.
          </Text>
        </View>
        <Text style={styles.body}>
          Email Mac with what your business does, your team size, the task you
          want to improve, and where you get stuck today.
        </Text>
        <Button title="Start a conversation" onPress={openEmail} />
        <Text style={styles.email} selectable>{PARTNER_EMAIL}</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: SPACING.xl, gap: SPACING.lg },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  heading: { ...TYPOGRAPHY.h3, color: colors.text },
  body: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  section: {
    gap: SPACING.sm,
    paddingBottom: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  email: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, textAlign: 'center' as const },
});
