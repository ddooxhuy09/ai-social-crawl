import EtsyListingPage from "../../EtsyListingPage";

export default function FinalPhase({ project }) {
  // Use project.id as the listing key — unique per project, stable across renames
  return (
    <EtsyListingPage
      initialListingName={project.id}
      embedded={true}
      projectId={project.id}
      projectName={project.name}
      projectCreatedAt={project.created_at}
    />
  );
}
