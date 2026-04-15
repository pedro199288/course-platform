import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
  render,
} from "@react-email/components";

interface AdminInvitationProps {
  schoolName: string;
  inviterName: string;
  acceptUrl: string;
}

function AdminInvitationTemplate({ schoolName, inviterName, acceptUrl }: AdminInvitationProps) {
  return (
    <Html>
      <Head />
      <Preview>You've been invited to manage {schoolName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>You're invited!</Heading>
          <Text style={text}>
            {inviterName} has invited you to join <strong>{schoolName}</strong> as an administrator.
          </Text>
          <Text style={text}>
            As an admin, you'll be able to manage courses, students, and settings for this school.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={acceptUrl}>
              Accept Invitation
            </Button>
          </Section>
          <Text style={footnote}>
            If the button doesn't work, copy and paste this link into your browser:{" "}
            <Link href={acceptUrl} style={link}>
              {acceptUrl}
            </Link>
          </Text>
          <Text style={footnote}>This invitation expires in 7 days.</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#f6f9fc",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 20px",
  maxWidth: "560px",
  borderRadius: "8px",
};

const heading = {
  fontSize: "24px",
  fontWeight: "bold" as const,
  textAlign: "center" as const,
  margin: "0 0 24px",
};

const text = {
  fontSize: "16px",
  lineHeight: "26px",
  color: "#333",
};

const buttonSection = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#000",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "bold" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const footnote = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#666",
};

const link = {
  color: "#0070f3",
};

export async function renderAdminInvitation(props: AdminInvitationProps) {
  return render(<AdminInvitationTemplate {...props} />);
}
