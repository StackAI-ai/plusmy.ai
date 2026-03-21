import { SafeAreaView, ScrollView, Text, View } from 'react-native';

const sections = [
  {
    title: 'Workspace layer',
    body: 'Switch between workspaces, review member roles, and confirm which tenancy boundary the current mobile session belongs to.'
  },
  {
    title: 'Connection health',
    body: 'See Google, Slack, and Notion installation status, connection scope, and reauth-required state without needing the desktop control plane.'
  },
  {
    title: 'Context visibility',
    body: 'Browse prompts, skills, and recent context assets so operators can inspect what the MCP server will expose.'
  },
  {
    title: 'MCP posture',
    body: 'Review endpoint metadata, client registrations, and the current production MCP base URL as a read-only operator surface.'
  }
];

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f4efe6' }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 34, fontWeight: '700', color: '#13201d' }}>plusmy.ai mobile</Text>
          <Text style={{ fontSize: 16, lineHeight: 26, color: '#55635f' }}>
            Read-only operator surface for workspaces, provider health, context visibility, and MCP status. The administrative write paths stay on web in v1.
          </Text>
        </View>
        {sections.map((section) => (
          <View
            key={section.title}
            style={{
              borderRadius: 24,
              backgroundColor: 'rgba(255,255,255,0.84)',
              padding: 20,
              shadowColor: '#13201d',
              shadowOpacity: 0.08,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 }
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#13201d' }}>{section.title}</Text>
            <Text style={{ marginTop: 10, fontSize: 15, lineHeight: 24, color: '#55635f' }}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
