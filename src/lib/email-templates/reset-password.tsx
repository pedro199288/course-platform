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

interface ResetPasswordProps {
  resetUrl: string;
}

function ResetPasswordTemplate({ resetUrl }: ResetPasswordProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your password</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Reset your password</Heading>
          <Text style={text}>
            We received a request to reset your password. Click the button below
            to choose a new one.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={resetUrl}>
              Reset Password
            </Button>
          </Section>
          <Text style={warning}>
            This link will expire in 30 minutes.
          </Text>
          <Text style={footnote}>
            If the button doesn't work, copy and paste this link into your
            browser:{" "}
            <Link href={resetUrl} style={link}>
              {resetUrl}
            </Link>
          </Text>
          <Text style={footnote}>
            If you didn't request a password reset, you can safely ignore this
            email. Your password will not be changed.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
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

const warning = {
  fontSize: "14px",
  lineHeight: "20px",
  color: "#e65100",
  textAlign: "center" as const,
  fontWeight: "bold" as const,
};

const footnote = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#666",
};

const link = {
  color: "#0070f3",
};

export async function renderResetPassword(props: ResetPasswordProps) {
  return render(<ResetPasswordTemplate {...props} />);
}
