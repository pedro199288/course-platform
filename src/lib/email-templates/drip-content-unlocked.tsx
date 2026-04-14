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

interface DripContentUnlockedProps {
  studentName: string;
  courseName: string;
  schoolName: string;
  courseUrl: string;
  /** Human-readable list of newly unlocked lesson/module titles */
  unlockedItems: string[];
}

function DripContentUnlockedTemplate({
  studentName,
  courseName,
  schoolName,
  courseUrl,
  unlockedItems,
}: DripContentUnlockedProps) {
  return (
    <Html>
      <Head />
      <Preview>
        New content available in {courseName}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>New Content Unlocked!</Heading>
          <Text style={text}>Hi {studentName},</Text>
          <Text style={text}>
            New content is now available in <strong>{courseName}</strong> on {schoolName}:
          </Text>
          <Section style={listSection}>
            {unlockedItems.map((item, i) => (
              <Text key={i} style={listItem}>
                • {item}
              </Text>
            ))}
          </Section>
          <Section style={buttonSection}>
            <Button style={button} href={courseUrl}>
              Continue Learning
            </Button>
          </Section>
          <Text style={footnote}>
            If the button doesn't work, copy and paste this link into your browser:{" "}
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

const listSection = {
  margin: "16px 0",
  padding: "0 16px",
};

const listItem = {
  fontSize: "15px",
  lineHeight: "22px",
  color: "#333",
  margin: "4px 0",
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

export type { DripContentUnlockedProps };

export async function renderDripContentUnlocked(props: DripContentUnlockedProps) {
  return render(<DripContentUnlockedTemplate {...props} />);
}
