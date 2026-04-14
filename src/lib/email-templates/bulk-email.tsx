import { Body, Container, Head, Heading, Html, Preview, Text, render } from "@react-email/components";

interface BulkEmailProps {
  studentName: string;
  courseName: string;
  schoolName: string;
  subject: string;
  body: string;
}

function BulkEmailTemplate({ studentName, courseName, schoolName, subject, body }: BulkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {subject} — {courseName}
      </Preview>
      <Body style={bodyStyle}>
        <Container style={container}>
          <Text style={courseBadge}>{courseName}</Text>
          <Heading style={heading}>{subject}</Heading>
          <Text style={text}>Hi {studentName},</Text>
          <Text style={text}>{body}</Text>
          <Text style={footnote}>
            You received this because you are enrolled in {courseName} on {schoolName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = {
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

const courseBadge = {
  fontSize: "12px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  color: "#666",
  margin: "0 0 8px",
};

const heading = {
  fontSize: "24px",
  fontWeight: "bold" as const,
  margin: "0 0 24px",
  color: "#111",
};

const text = {
  fontSize: "16px",
  lineHeight: "26px",
  color: "#333",
  whiteSpace: "pre-wrap" as const,
};

const footnote = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#666",
  marginTop: "32px",
  borderTop: "1px solid #eee",
  paddingTop: "16px",
};

export type { BulkEmailProps };

export async function renderBulkEmail(props: BulkEmailProps) {
  return render(<BulkEmailTemplate {...props} />);
}
