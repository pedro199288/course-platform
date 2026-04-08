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

interface CertificateDeliveryProps {
  studentName: string;
  courseName: string;
  schoolName: string;
  certificateUrl: string;
  completionDate: string;
}

function CertificateDeliveryTemplate({
  studentName,
  courseName,
  schoolName,
  certificateUrl,
  completionDate,
}: CertificateDeliveryProps) {
  return (
    <Html>
      <Head />
      <Preview>Your certificate for {courseName} is ready</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Congratulations!</Heading>
          <Text style={text}>Hi {studentName},</Text>
          <Text style={text}>
            You've completed <strong>{courseName}</strong> on {schoolName}.
            Your certificate of completion is ready to download.
          </Text>
          <Text style={completionText}>
            Completed on {completionDate}
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={certificateUrl}>
              Download Certificate
            </Button>
          </Section>
          <Text style={footnote}>
            If the button doesn't work, copy and paste this link into your
            browser:{" "}
            <Link href={certificateUrl} style={link}>
              {certificateUrl}
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

const completionText = {
  fontSize: "14px",
  color: "#666",
  textAlign: "center" as const,
  fontStyle: "italic" as const,
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

export type { CertificateDeliveryProps };

export async function renderCertificateDelivery(props: CertificateDeliveryProps) {
  return render(<CertificateDeliveryTemplate {...props} />);
}
