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

interface EnrollmentConfirmationProps {
  studentName: string;
  courseName: string;
  schoolName: string;
  courseUrl: string;
}

function EnrollmentConfirmationTemplate({
  studentName,
  courseName,
  schoolName,
  courseUrl,
}: EnrollmentConfirmationProps) {
  return (
    <Html>
      <Head />
      <Preview>You're enrolled in {courseName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>You're In!</Heading>
          <Text style={text}>Hi {studentName},</Text>
          <Text style={text}>
            You've been enrolled in <strong>{courseName}</strong> on{" "}
            {schoolName}. You can start learning right away.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={courseUrl}>
              Start Learning
            </Button>
          </Section>
          <Text style={footnote}>
            If the button doesn't work, copy and paste this link into your
            browser:{" "}
            <Link href={courseUrl} style={link}>
              {courseUrl}
            </Link>
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

const footnote = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#666",
};

const link = {
  color: "#0070f3",
};

export type { EnrollmentConfirmationProps };

export async function renderEnrollmentConfirmation(props: EnrollmentConfirmationProps) {
  return render(<EnrollmentConfirmationTemplate {...props} />);
}
