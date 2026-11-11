
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenCheck,
  FileSpreadsheet,
  Languages,
  ShieldCheck,
  Tags,
} from "lucide-react";

const actions = [
  {
    icon: FileSpreadsheet,
    title: "Import one Excel workbook",
    description:
      "Upload one exam-event workbook containing Paper I and Paper II, then inspect row-level validation.",
    href: "/imports",
    action: "Open Excel Import Centre",
  },
  {
    icon: BookOpenCheck,
    title: "Edit questions",
    description:
      "Edit English and Hindi content, options, answers, classifications, explanations and media.",
    href: "/questions",
    action: "Open Question Bank",
  },
  {
    icon: Tags,
    title: "Assign the syllabus taxonomy",
    description:
      "Apply the appropriate Paper I or Geography hierarchy, add related topics and searchable keywords.",
    href: "/syllabus",
    action: "Open Syllabus Manager",
  },
];

export default function AdminHome() {
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <div className="admin-eyebrow">
            CrackJRF content operations
          </div>
          <h1>Question Bank workspace</h1>
          <p>
            One trusted Excel workbook in; all structurally valid questions publish together.
            Every field remains editable afterwards.
          </p>
        </div>

        <Link className="admin-button" href="/imports">
          <FileSpreadsheet size={14} />
          Import Excel workbook
        </Link>
      </div>

      <div className="admin-stat-grid">
        {[
          {
            icon: FileSpreadsheet,
            value: "01",
            title: "Excel workbook",
            foot: "One file per exam event / shift",
          },
          {
            icon: BookOpenCheck,
            value: "I + II",
            title: "Combined papers",
            foot: "Paper I and Paper II in one Questions sheet",
          },
          {
            icon: Languages,
            value: "EN · HI",
            title: "Language variants",
            foot: "English and Hindi, edited side by side",
          },
          {
            icon: ShieldCheck,
            value: "Private",
            title: "Publication control",
            foot: "Import batch publish + direct editor publish",
          },
        ].map((item) => {
          const Icon = item.icon;

          return (
            <div className="admin-stat" key={item.title}>
              <div className="admin-stat-icon">
                <Icon size={16} />
              </div>
              <div className="admin-stat-label">{item.title}</div>
              <div
                className="admin-stat-value"
                style={{ fontSize: item.value.length > 8 ? 17 : 24 }}
              >
                {item.value}
              </div>
              <div className="admin-stat-foot">{item.foot}</div>
            </div>
          );
        })}
      </div>

      <div className="admin-grid">
        <section className="admin-panel">
          <div className="admin-panel-title">
            Quick actions
          </div>
          <div className="admin-panel-sub">
            Import, edit and manage your published question bank.
          </div>

          {actions.map((item, index) => {
            const Icon = item.icon;

            return (
              <div className="admin-row" key={item.title}>
                <div className="admin-row-icon">
                  <Icon size={16} />
                </div>

                <div className="admin-row-main">
                  <b>
                    {index + 1}. {item.title}
                  </b>
                  <small>{item.description}</small>
                </div>

                <Link
                  className="admin-button secondary"
                  href={item.href}
                >
                  {item.action}
                  <ArrowUpRight size={13} />
                </Link>
              </div>
            );
          })}
        </section>

        <aside className="admin-panel">
          <div className="admin-panel-title">
            Content workflow
          </div>
          <div className="admin-panel-sub">
            A trusted workbook is published in one operation. You can edit and republish any question later.
          </div>

          {[
            "One Excel workbook per exam event or shift",
            "Paper I and Paper II can be imported together",
            "English and Hindi remain independently editable",
            "Answers are taken from the trusted workbook",
            "Syllabus taxonomy is selected from the compact tree",
            "Save Draft preserves the current live version",
            "Publish sends the updated question to students",
          ].map((item, index) => (
            <div className="admin-row" key={item}>
              <div className="admin-row-icon">{index + 1}</div>
              <div className="admin-row-main">
                <b>{item}</b>
              </div>
            </div>
          ))}

          <div className="admin-callout">
            The import is atomic: if a workbook has structural errors, no partial batch is published. A successful workbook publishes all questions together.
          </div>
        </aside>
      </div>
    </>
  );
}
