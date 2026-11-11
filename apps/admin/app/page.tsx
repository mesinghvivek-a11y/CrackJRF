
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenCheck,
  FileSpreadsheet,
  Languages,
  ListChecks,
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
    icon: ListChecks,
    title: "Edit and verify question content",
    description:
      "Correct stems, options, answer evidence, language variants, explanations and source references.",
    href: "/review",
    action: "Open Review Workspace",
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
            One Excel workbook in; editable, reviewed and approved
            questions out. Imported content is never published automatically.
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
            value: "EN · HI · Hinglish",
            title: "Language variants",
            foot: "Independent review before student display",
          },
          {
            icon: ShieldCheck,
            value: "Private",
            title: "Publication control",
            foot: "Reviewer verification + Super Admin approval",
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
            Recommended next actions
          </div>
          <div className="admin-panel-sub">
            Follow the same sequence for every examination event.
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
            Editorial and publishing gates
          </div>
          <div className="admin-panel-sub">
            These checks protect the Student Portal from unreviewed content.
          </div>

          {[
            "Official question text and original order reconciled",
            "All four English options present and reviewed",
            "Unit, section and topic assigned",
            "Provider answer evidence checked against its source",
            "Answer verified by Reviewer or Super Admin",
            "Hindi / Hinglish variants independently reviewed",
            "Images, diagrams and explanations checked",
            "Super Admin approves publication",
          ].map((item, index) => (
            <div className="admin-row" key={item}>
              <div className="admin-row-icon">{index + 1}</div>
              <div className="admin-row-main">
                <b>{item}</b>
              </div>
            </div>
          ))}

          <div className="admin-callout">
            The vendor workbook is a content handoff, not an approval.
            An imported answer remains unverified, and language variants
            remain hidden until their own review checks pass.
          </div>
        </aside>
      </div>
    </>
  );
}
