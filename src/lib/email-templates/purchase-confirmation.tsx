import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
  render,
} from "@react-email/components";

interface PurchaseConfirmationProps {
  studentName: string;
  courseName: string;
  amount: string;
  currency: string;
  schoolName: string;
}

function PurchaseConfirmationTemplate({
  studentName,
  courseName,
  amount,
  currency,
  schoolName,
}: PurchaseConfirmationProps) {
  const formattedAmount = `${currency.toUpperCase()} ${amount}`;

  return (
    <Html>
      <Head />
      <Preview>Purchase confirmed — {courseName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Purchase Confirmed</Heading>
          <Text style={text}>Hi {studentName},</Text>
          <Text style={text}>
            Your purchase has been confirmed. You now have access to the course.
          </Text>
          <Section style={detailsSection}>
            <Text style={detailLabel}>Course</Text>
            <Text style={detailValue}>{courseName}</Text>
            <Hr style={hr} />
            <Text style={detailLabel}>Amount</Text>
            <Text style={detailValue}>{formattedAmount}</Text>
            <Hr style={hr} />
            <Text style={detailLabel}>School</Text>
            <Text style={detailValue}>{schoolName}</Text>
          </Section>
          <Text style={footnote}>
            If you have any questions, please contact {schoolName} directly.
          </Text>
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

const detailsSection = {
  backgroundColor: "#f9fafb",
  borderRadius: "6px",
  padding: "16px 20px",
  margin: "24px 0",
};

const detailLabel = {
  fontSize: "12px",
  fontWeight: "bold" as const,
  color: "#666",
  textTransform: "uppercase" as const,
  margin: "0 0 2px",
};

const detailValue = {
  fontSize: "16px",
  color: "#333",
  margin: "0 0 8px",
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "8px 0",
};

const footnote = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#666",
};

export type { PurchaseConfirmationProps };

export async function renderPurchaseConfirmation(props: PurchaseConfirmationProps) {
  return render(<PurchaseConfirmationTemplate {...props} />);
}
