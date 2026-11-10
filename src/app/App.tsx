import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MarketPage } from "./MarketPage";
import { OrganizerLogin } from "./OrganizerLogin";
import { DashboardPage } from "./DashboardPage";
import { OwnerLoginPage, OwnerRegistrationPage, OwnerShopsPage, PasswordResetPage, PlatformHome, ShopOrderPage, ShopSetupPage, VerifyEmailPage } from "./TenantPages";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PlatformHome />} />
        <Route path="/shops/new" element={<Navigate to="/owners/new" replace />} />
        <Route path="/shops/:shopSlug/orders/:orderId" element={<ShopOrderPage />} />
        <Route path="/shops/:shopSlug" element={<MarketPage />} />
        <Route path="/owners/new" element={<OwnerRegistrationPage />} />
        <Route path="/password-reset" element={<PasswordResetPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/:ownerSlug/:shopSlug/orders/:orderId" element={<ShopOrderPage />} />
        <Route path="/:ownerSlug/:shopSlug" element={<MarketPage />} />
        <Route path="/dashboard/login" element={<OwnerLoginPage />} />
        <Route path="/dashboard/shops" element={<OwnerShopsPage />} />
        <Route path="/dashboard/shops/new" element={<ShopSetupPage />} />
        <Route path="/dashboard/:ownerSlug/:shopSlug" element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/organizer" element={<OrganizerLogin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
