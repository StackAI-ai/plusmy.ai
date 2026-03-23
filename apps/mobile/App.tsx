import { SafeAreaView, ScrollView, Text, View } from 'react-native';

const workspaceContext = {
  name: 'Default workspace',
  role: 'member',
  membershipScope: 'workspace'
};

const sections = [
  {
    title: 'Workspace layer',
    body: 'Switch between workspaces, review member roles, and confirm which tenancy boundary the current mobile session belongs to.'
  },
  {
    title: 'Connection health',
    body: 'See live provider installation status, connection scope, and reauth-required state without needing the desktop control plane.'
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

const webOnlyActions = [
  'Provider OAuth installation + reauthorization',
  'Invite members or transfer workspace ownership',
  'Approve MCP client consent and revoke approvals',
  'Rotate MCP client secrets or JWKS keys',
  'Admin MFA enrollment and enforcement'
];

export default function App() {
  const canAdmin = workspaceContext.role === 'owner' || workspaceContext.role === 'admin';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f4efe6' }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 34, fontWeight: '700', color: '#13201d' }}>plusmy.ai mobile</Text>
          <Text style={{ fontSize: 16, lineHeight: 26, color: '#55635f' }}>
            Read-only operator surface for workspaces, provider health, context visibility, and MCP status. The administrative write paths stay on web in v1.
          </Text>
        </View>
        <View
          style={{
            borderRadius: 24,
            backgroundColor: 'rgba(19,32,29,0.92)',
            padding: 20
          }}
        >
          <Text style={{ fontSize: 12, letterSpacing: 2, color: '#c4d0cb', textTransform: 'uppercase' }}>Workspace context</Text>
          <Text style={{ marginTop: 8, fontSize: 20, fontWeight: '700', color: '#f6f2ea' }}>{workspaceContext.name}</Text>
          <Text style={{ marginTop: 6, fontSize: 14, color: '#d6e0dc' }}>
            Role: {workspaceContext.role} • Scope: {workspaceContext.membershipScope}
          </Text>
          <Text style={{ marginTop: 10, fontSize: 13, lineHeight: 20, color: '#c4d0cb' }}>
            {canAdmin
              ? 'Admin-level controls are available on web. Mobile surfaces remain read-only by design.'
              : 'Member access is read-only. Admin-only tasks are intentionally web-only.'}
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
        <View
          style={{
            borderRadius: 24,
            backgroundColor: 'rgba(255,255,255,0.84)',
            padding: 20,
            borderWidth: 1,
            borderColor: 'rgba(175, 144, 90, 0.35)'
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#7a4f1d' }}>Admin-only flows (web required)</Text>
          <Text style={{ marginTop: 10, fontSize: 14, lineHeight: 22, color: '#8b5a2b' }}>
            These workflows are intentionally disabled on mobile. Use the web operator surface to complete them.
          </Text>
          <View style={{ marginTop: 12, gap: 8 }}>
            {webOnlyActions.map((item) => (
              <View key={item} style={{ padding: 10, borderRadius: 14, backgroundColor: 'rgba(255, 246, 232, 0.9)' }}>
                <Text style={{ fontSize: 13, color: '#7a4f1d' }}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
        <View
          style={{
            borderRadius: 24,
            backgroundColor: 'rgba(255,255,255,0.84)',
            padding: 20,
            borderWidth: 1,
            borderColor: 'rgba(107, 114, 128, 0.2)'
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#13201d' }}>Unsupported on mobile</Text>
          <Text style={{ marginTop: 10, fontSize: 14, lineHeight: 22, color: '#55635f' }}>
            OAuth callback handling, MFA enrollment, and approval revocation are blocked on mobile to keep security posture consistent. Mobile surfaces can
            only view status and queued work.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
