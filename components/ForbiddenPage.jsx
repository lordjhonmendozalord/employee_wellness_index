function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-red-600">403</h1>
        <p className="mt-2 text-slate-600">
          You do not have permission to access this page.
        </p>
      </div>
    </div>
  );
}

export default ForbiddenPage;